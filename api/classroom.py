"""
Real-time classroom session management.

Routes:
  POST /classroom/sessions            create session + QR code
  GET  /classroom/sessions/{id}       session metadata
  WS   /classroom/{id}/host           teacher connection
  WS   /classroom/{id}/student        student connections
"""
from __future__ import annotations
import asyncio
import base64
import io
import json
import os
import secrets
import socket
import time
from dataclasses import dataclass, field
from typing import Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from pydantic import BaseModel

from api.auth import require_admin
import chromadb
from ingestion.load import CHROMA_PATH, COLLECTION_NAME

router = APIRouter(prefix="/classroom", tags=["classroom"])

# ── Constants ─────────────────────────────────────────────────────────────────

SCORE_MAX  = 1000
TIME_LIMIT = 30   # seconds — used for scoring only, not shown to students

CHOICE_COLORS = {"A": "#e74c3c", "B": "#2980b9", "C": "#f39c12", "D": "#27ae60"}


# ── Session dataclasses ───────────────────────────────────────────────────────

@dataclass
class Student:
    id:    str
    name:  str
    ws:    Optional[WebSocket] = None
    score: int = 0


@dataclass
class Session:
    id:                  str
    host_ws:             Optional[WebSocket]          = None
    students:            dict[str, Student]           = field(default_factory=dict)
    phase:               str                          = "waiting"   # waiting|question|revealed|ended
    current_question:    Optional[dict]               = None
    question_started_at: Optional[float]              = None
    answers:             dict[str, str]               = field(default_factory=dict)   # student_id → letter
    answer_times:        dict[str, float]             = field(default_factory=dict)   # student_id → timestamp


# Module-level session store (ephemeral — lost on server restart, which is fine)
_sessions: dict[str, Session] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


def _make_qr(url: str) -> str:
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _score(is_correct: bool, elapsed: float) -> int:
    if not is_correct:
        return 0
    ratio = max(0.0, 1.0 - elapsed / TIME_LIMIT * 0.5)
    return round(SCORE_MAX * ratio)


def _is_spr(question: dict) -> bool:
    choices = question.get("choices") or []
    return not any(str(c).strip() for c in choices)


def _spr_correct(student_ans: str, correct: str) -> bool:
    try:
        return abs(float(student_ans) - float(correct)) < 1e-9
    except (ValueError, TypeError):
        return student_ans.strip().lower() == correct.strip().lower()


def _breakdown(session: Session) -> dict[str, int]:
    tally: dict[str, int] = {"A": 0, "B": 0, "C": 0, "D": 0}
    for ans in session.answers.values():
        if ans in tally:
            tally[ans] += 1
    return tally


def _leaderboard(session: Session) -> list[dict]:
    return sorted(
        [{"id": s.id, "name": s.name, "score": s.score} for s in session.students.values()],
        key=lambda x: x["score"],
        reverse=True,
    )


async def _send(ws: Optional[WebSocket], msg: dict) -> None:
    if ws and ws.client_state == WebSocketState.CONNECTED:
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            pass


async def _broadcast(session: Session, msg: dict) -> None:
    for student in list(session.students.values()):
        await _send(student.ws, msg)


def _fetch_question(question_id: str) -> dict:
    col = chromadb.PersistentClient(path=CHROMA_PATH).get_collection(COLLECTION_NAME)
    r   = col.get(ids=[question_id], include=["documents", "metadatas"])
    if not r["ids"]:
        raise ValueError(f"Question {question_id!r} not found")
    meta = r["metadatas"][0]
    return {
        "id":             question_id,
        "question_text":  r["documents"][0],
        "choices":        json.loads(meta["choices"]),
        "correct_answer": meta["correct_answer"],
        "skill":          meta["skill"],
        "domain":         meta["domain"],
        "difficulty":     meta["difficulty"],
        "image_path":     meta.get("image_path") or "",
    }


# ── REST endpoints ────────────────────────────────────────────────────────────

class SessionOut(BaseModel):
    session_id: str
    join_url:   str
    qr_b64:     str


@router.post("/sessions", response_model=SessionOut)
def create_session(_admin: dict = Depends(require_admin)):
    sid  = secrets.token_urlsafe(6)
    _sessions[sid] = Session(id=sid)
    # PUBLIC_BASE_URL overrides local IP — set this to your ngrok URL when tunnelling
    base     = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/") or f"http://{_local_ip()}:5173"
    join_url = f"{base}/join/{sid}"
    return SessionOut(session_id=sid, join_url=join_url, qr_b64=_make_qr(join_url))


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    s = _sessions.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id":    s.id,
        "phase":         s.phase,
        "student_count": len(s.students),
    }


# ── Host WebSocket ────────────────────────────────────────────────────────────

@router.websocket("/{session_id}/host")
async def host_ws(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = _sessions.get(session_id)
    if not session:
        await websocket.close(code=4004)
        return
    session.host_ws = websocket

    await _send(websocket, {
        "type":             "connected",
        "count":            len(session.students),
        "students":         [{"id": s.id, "name": s.name, "score": s.score}
                             for s in session.students.values()],
        "phase":            session.phase,
        "current_question": session.current_question,
        "breakdown":        _breakdown(session) if session.answers else None,
        "answer_count":     len(session.answers),
        "leaderboard":      _leaderboard(session) if session.phase == "revealed" else None,
        "spr_results":      [
            {"name": s.name, "answer": session.answers.get(s.id),
             "is_correct": _spr_correct(session.answers.get(s.id, ""), session.current_question["correct_answer"])
                           if session.answers.get(s.id) else False}
            for s in session.students.values()
        ] if session.phase == "revealed" and session.current_question and session.current_question.get("question_type") == "spr" else None,
    })

    try:
        while True:
            data     = json.loads(await websocket.receive_text())
            msg_type = data.get("type")

            # ── push a question to all students ──────────────────────────────
            if msg_type == "push_question":
                try:
                    q = _fetch_question(data["question_id"])
                except ValueError as exc:
                    await _send(websocket, {"type": "error", "detail": str(exc)})
                    continue

                q["question_type"]          = "spr" if _is_spr(q) else "mcq"
                session.current_question    = q
                session.phase               = "question"
                session.answers             = {}
                session.answer_times        = {}
                session.question_started_at = time.time()

                await _send(websocket, {"type": "question_pushed", "question": q})

                # Strip correct answer before broadcasting to students
                student_q = {k: v for k, v in q.items() if k != "correct_answer"}
                await _broadcast(session, {"type": "question", "question": student_q})

            # ── reveal answer ─────────────────────────────────────────────────
            elif msg_type == "reveal":
                if not session.current_question:
                    continue
                session.phase = "revealed"
                correct       = session.current_question["correct_answer"]
                is_spr        = session.current_question.get("question_type") == "spr"

                # Award points and send personalised result to each student
                spr_results = []
                for s in session.students.values():
                    ans        = session.answers.get(s.id)
                    t          = session.answer_times.get(s.id)
                    elapsed    = (t - session.question_started_at) if t else TIME_LIMIT
                    is_correct = _spr_correct(ans, correct) if (is_spr and ans) else (ans == correct)
                    pts        = _score(is_correct, elapsed)
                    s.score   += pts
                    await _send(s.ws, {
                        "type":           "revealed",
                        "correct_answer": correct,
                        "your_answer":    ans,
                        "is_correct":     is_correct,
                        "points_earned":  pts,
                        "total_score":    s.score,
                    })
                    if is_spr:
                        spr_results.append({"name": s.name, "answer": ans, "is_correct": is_correct})

                host_msg = {
                    "type":           "revealed",
                    "correct_answer": correct,
                    "leaderboard":    _leaderboard(session),
                }
                if is_spr:
                    host_msg["question_type"] = "spr"
                    host_msg["spr_results"]   = spr_results
                else:
                    host_msg["breakdown"] = _breakdown(session)
                await _send(websocket, host_msg)

            # ── show leaderboard ──────────────────────────────────────────────
            elif msg_type == "leaderboard":
                board = _leaderboard(session)
                await _send(websocket, {"type": "leaderboard", "scores": board})
                await _broadcast(session, {"type": "leaderboard", "scores": board})

            # ── end session ───────────────────────────────────────────────────
            elif msg_type == "end":
                session.phase = "ended"
                await _broadcast(session, {"type": "ended"})
                await _send(websocket, {"type": "ended"})

    except WebSocketDisconnect:
        session.host_ws = None


# ── Student WebSocket ─────────────────────────────────────────────────────────

@router.websocket("/{session_id}/student")
async def student_ws(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = _sessions.get(session_id)
    if not session:
        await websocket.close(code=4004)
        return
    student_id: Optional[str] = None

    try:
        # First message: "join" (new) or "rejoin" (reconnecting after backgrounding)
        raw  = await asyncio.wait_for(websocket.receive_text(), timeout=30)
        data = json.loads(raw)

        if data.get("type") == "rejoin":
            # Restore an existing student's connection
            student_id = data.get("student_id", "")
            student    = session.students.get(student_id)
            if not student:
                await websocket.close(code=4001)
                return
            student.ws = websocket
            await _send(websocket, {
                "type":       "rejoined",
                "student_id": student_id,
                "name":       student.name,
                "score":      student.score,
            })
        elif data.get("type") == "join":
            name       = (data.get("name") or "Anonymous").strip()[:30]
            student_id = secrets.token_urlsafe(8)
            student    = Student(id=student_id, name=name, ws=websocket)
            session.students[student_id] = student
            await _send(websocket, {"type": "joined", "student_id": student_id, "name": name})
            await _send(session.host_ws, {
                "type":       "student_joined",
                "student_id": student_id,
                "name":       name,
                "count":      len(session.students),
            })
        else:
            await websocket.close(code=4000)
            return

        # Send current session state so the student lands in the right phase
        if session.phase == "question" and session.current_question:
            student_q = {k: v for k, v in session.current_question.items() if k != "correct_answer"}
            if student_id in session.answers:
                # Already answered — send question too so a reloaded page can render it
                student_q = {k: v for k, v in session.current_question.items() if k != "correct_answer"}
                await _send(websocket, {"type": "answered", "answer": session.answers[student_id], "question": student_q})
            else:
                await _send(websocket, {"type": "question", "question": student_q, "time_limit": TIME_LIMIT})
        elif session.phase == "revealed" and session.current_question:
            correct    = session.current_question["correct_answer"]
            is_spr     = session.current_question.get("question_type") == "spr"
            ans        = session.answers.get(student_id)
            t          = session.answer_times.get(student_id)
            elapsed    = (t - session.question_started_at) if t else TIME_LIMIT
            is_correct = _spr_correct(ans, correct) if (is_spr and ans) else (ans == correct)
            pts        = _score(is_correct, elapsed)
            await _send(websocket, {
                "type":           "revealed",
                "correct_answer": correct,
                "your_answer":    ans,
                "is_correct":     is_correct,
                "points_earned":  pts,
                "total_score":    student.score,
            })
        elif session.phase == "ended":
            await _send(websocket, {"type": "ended"})

        # Message loop
        while True:
            raw  = await websocket.receive_text()
            data = json.loads(raw)

            if data.get("type") == "answer" and session.phase == "question":
                if student_id not in session.answers:
                    ans = data.get("answer", "")
                    session.answers[student_id]      = ans
                    session.answer_times[student_id] = time.time()

                    await _send(websocket, {"type": "answered", "answer": ans})

                    await _send(session.host_ws, {
                        "type":      "answer_in",
                        "count":     len(session.answers),
                        "total":     len(session.students),
                        "breakdown": _breakdown(session),
                    })

    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        # Keep the student in the session so they can rejoin — just clear the WS reference
        if student_id and student_id in session.students:
            session.students[student_id].ws = None
