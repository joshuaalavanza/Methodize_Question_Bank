"""
Quarry API — SAT question bank.

Routes:
  GET /questions               browse with optional filters
  GET /questions/{id}          single question detail
  GET /questions/{id}/similar  top-3 similar questions
  GET /filters                 available filter values for dropdowns
"""
from __future__ import annotations
import json
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

import anthropic
import chromadb
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ingestion.load import CHROMA_PATH, COLLECTION_NAME
from retrieval.similar import find_similar, find_similar_for_text
from api.db import SessionLocal, User, Attempt
from api.auth import create_token, require_user, require_admin, is_admin_username

_claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


# ── lifespan: open ChromaDB once, share across requests ──────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.col = chromadb.PersistentClient(path=CHROMA_PATH).get_collection(COLLECTION_NAME)
    yield


app = FastAPI(title="Quarry", description="SAT question bank API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.mount("/images", StaticFiles(directory="data/structured/images"), name="images")


# ── response models ───────────────────────────────────────────────────────────

class QuestionSummary(BaseModel):
    id: str
    question_text: str
    domain: str
    skill: str
    difficulty: str
    source: str

class QuestionDetail(QuestionSummary):
    choices: list[str]
    correct_answer: str
    explanation: str
    image_url: Optional[str] = None   # absolute URL to cropped question PNG

class SimilarItem(QuestionDetail):
    distance: float
    fallback_used: bool = False

class FiltersResponse(BaseModel):
    domains: list[str]
    skills: list[str]
    skills_by_domain: dict[str, list[str]]
    difficulties: list[str]
    sources: list[str]


# ── helpers ───────────────────────────────────────────────────────────────────

def _build_where(domain, skill, difficulty, source, domains=None) -> dict | None:
    conditions = []
    if domain:
        conditions.append({"domain": {"$eq": domain}})
    elif domains:
        conditions.append({"domain": {"$in": list(domains)}})
    if skill:
        conditions.append({"skill":      {"$eq": skill}})
    if difficulty:
        conditions.append({"difficulty": {"$eq": difficulty}})
    if source:
        conditions.append({"source":     {"$eq": source}})
    if not conditions:
        return None
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


_IMAGE_BASE = "http://localhost:8000/images"


def _to_detail(qid: str, doc: str, meta: dict) -> QuestionDetail:
    img_path = meta.get("image_path") or ""
    return QuestionDetail(
        id=qid,
        question_text=doc,
        domain=meta["domain"],
        skill=meta["skill"],
        difficulty=meta["difficulty"],
        source=meta["source"],
        choices=json.loads(meta["choices"]),
        correct_answer=meta["correct_answer"],
        explanation=meta["explanation"],
        image_url=f"{_IMAGE_BASE}/{img_path}" if img_path else None,
    )


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/questions", response_model=list[QuestionSummary])
def list_questions(
    request: Request,
    domain:     Optional[str] = Query(None),
    domains:    list[str]     = Query(default=[]),   # subject-level multi-domain filter
    skill:      Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    source:     Optional[str] = Query(None),
):
    """Browse questions with optional metadata filters."""
    col = request.app.state.col
    # If specific domain given, use it; else if subject domains given, filter to those
    effective_domain = domain
    effective_domains = domains if not domain else []
    where = _build_where(effective_domain, skill, difficulty, source, effective_domains)
    kwargs: dict = dict(include=["metadatas", "documents"])
    if where:
        kwargs["where"] = where
    r = col.get(**kwargs)

    return [
        QuestionSummary(
            id=qid,
            question_text=doc,
            domain=meta["domain"],
            skill=meta["skill"],
            difficulty=meta["difficulty"],
            source=meta["source"],
        )
        for qid, doc, meta in zip(r["ids"], r["documents"], r["metadatas"])
    ]


@app.get("/questions/{question_id}/similar", response_model=list[SimilarItem])
def similar_questions(question_id: str, n: int = Query(3, ge=1, le=10)):
    """Return top-n similar questions using hybrid skill-filter + embedding rank."""
    try:
        results = find_similar(question_id, n=n)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return [
        SimilarItem(
            id=r.id,
            question_text=r.question_text,
            domain=r.domain,
            skill=r.skill,
            difficulty=r.difficulty,
            source=r.source,
            choices=r.choices,
            correct_answer=r.correct_answer,
            explanation=r.explanation,
            image_url=f"{_IMAGE_BASE}/{r.image_path}" if r.image_path else None,
            distance=r.distance,
            fallback_used=r.fallback_used,
        )
        for r in results
    ]


@app.get("/questions/{question_id}", response_model=QuestionDetail)
def get_question(request: Request, question_id: str):
    """Fetch a single question by its College Board Question ID."""
    col = request.app.state.col
    r = col.get(ids=[question_id], include=["metadatas", "documents"])
    if not r["ids"]:
        raise HTTPException(status_code=404, detail=f"Question '{question_id}' not found")
    return _to_detail(r["ids"][0], r["documents"][0], r["metadatas"][0])


@app.get("/filters", response_model=FiltersResponse)
def get_filters(request: Request):
    """Return distinct metadata values for populating UI filter dropdowns."""
    col = request.app.state.col
    all_meta = col.get(include=["metadatas"])["metadatas"]
    skills_by_domain: dict[str, set] = {}
    for m in all_meta:
        skills_by_domain.setdefault(m["domain"], set()).add(m["skill"])
    return FiltersResponse(
        domains=sorted({m["domain"] for m in all_meta}),
        skills=sorted({m["skill"] for m in all_meta}),
        skills_by_domain={d: sorted(s) for d, s in skills_by_domain.items()},
        difficulties=sorted({m["difficulty"] for m in all_meta}),
        sources=sorted({m["source"] for m in all_meta}),
    )


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str

class LoginResponse(BaseModel):
    token: str
    user_id: int
    username: str
    is_admin: bool

@app.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest):
    """Log in or auto-create an account with just a username."""
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            user = User(username=username)
            db.add(user)
            db.commit()
            db.refresh(user)
        token = create_token(user.id, user.username)
        return LoginResponse(
            token=token,
            user_id=user.id,
            username=user.username,
            is_admin=is_admin_username(user.username),
        )
    finally:
        db.close()

@app.get("/auth/me")
def get_me(current_user: dict = Depends(require_user)):
    return {
        "user_id":  int(current_user["sub"]),
        "username": current_user["username"],
        "is_admin": current_user.get("is_admin", False),
    }


# ── Attempts ──────────────────────────────────────────────────────────────────

class AttemptRequest(BaseModel):
    question_id:   str
    skill:         str
    domain:        str
    is_correct:    bool
    chosen_answer: Optional[str] = None

class AttemptOut(BaseModel):
    question_id: str
    skill:       str
    domain:      str
    is_correct:  bool
    created_at:  str

@app.post("/attempts", status_code=201)
def record_attempt(body: AttemptRequest, current_user: dict = Depends(require_user)):
    """Persist a question attempt for the logged-in user."""
    db = SessionLocal()
    try:
        # Only store the first attempt per question per user
        existing = db.query(Attempt).filter(
            Attempt.user_id     == int(current_user["sub"]),
            Attempt.question_id == body.question_id,
        ).first()
        if existing:
            return {"ok": True, "duplicate": True}
        attempt = Attempt(
            user_id       = int(current_user["sub"]),
            question_id   = body.question_id,
            skill         = body.skill,
            domain        = body.domain,
            is_correct    = body.is_correct,
            chosen_answer = body.chosen_answer,
        )
        db.add(attempt)
        db.commit()
        return {"ok": True, "duplicate": False}
    finally:
        db.close()

@app.get("/progress/me", response_model=list[AttemptOut])
def get_progress(current_user: dict = Depends(require_user)):
    """Return all attempts for the logged-in user, newest first."""
    db = SessionLocal()
    try:
        attempts = (
            db.query(Attempt)
            .filter(Attempt.user_id == int(current_user["sub"]))
            .order_by(Attempt.created_at.desc())
            .all()
        )
        return [
            AttemptOut(
                question_id = a.question_id,
                skill       = a.skill,
                domain      = a.domain,
                is_correct  = a.is_correct,
                created_at  = a.created_at.isoformat(),
            )
            for a in attempts
        ]
    finally:
        db.close()


# ── Tutor Dashboard ───────────────────────────────────────────────────────────

def _skill_breakdown(attempts: list) -> dict:
    """Return {skill: {correct, total}} from a list of Attempt rows."""
    stats: dict = {}
    for a in attempts:
        s = a.skill or "Unknown"
        stats.setdefault(s, {"correct": 0, "total": 0})
        stats[s]["total"] += 1
        if a.is_correct:
            stats[s]["correct"] += 1
    return stats


def _domain_breakdown(attempts: list) -> dict:
    stats: dict = {}
    for a in attempts:
        d = a.domain or "Unknown"
        stats.setdefault(d, {"correct": 0, "total": 0})
        stats[d]["total"] += 1
        if a.is_correct:
            stats[d]["correct"] += 1
    return stats


def _weakest_skill(skill_stats: dict) -> str | None:
    qualified = [(s, v) for s, v in skill_stats.items() if v["total"] >= 2]
    if not qualified:
        return None
    return min(qualified, key=lambda x: x[1]["correct"] / x[1]["total"])[0]


@app.get("/dashboard")
def get_dashboard(_admin: dict = Depends(require_admin)):
    """Return summary stats for every student (tutor view)."""
    db = SessionLocal()
    try:
        users = db.query(User).all()
        rows = []
        for user in users:
            attempts = db.query(Attempt).filter(Attempt.user_id == user.id).all()
            if not attempts:
                continue
            total   = len(attempts)
            correct = sum(1 for a in attempts if a.is_correct)
            skill_stats = _skill_breakdown(attempts)
            rows.append({
                "user_id":      user.id,
                "username":     user.username,
                "attempted":    total,
                "correct":      correct,
                "accuracy":     round(correct / total * 100),
                "weakest_skill": _weakest_skill(skill_stats),
                "last_active":  max(a.created_at for a in attempts).isoformat(),
            })
        # Sort: lowest accuracy first so struggling students are at the top
        return sorted(rows, key=lambda r: r["accuracy"])
    finally:
        db.close()


@app.get("/dashboard/{user_id}")
def get_student_detail(user_id: int, request: Request, _admin: dict = Depends(require_admin)):
    """Return question history + skill/domain breakdown for one student."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Student not found")

        attempts = (
            db.query(Attempt)
            .filter(Attempt.user_id == user_id)
            .order_by(Attempt.created_at.desc())
            .all()
        )

        # Batch-fetch question data from ChromaDB in one call
        col = request.app.state.col
        unique_ids = list({a.question_id for a in attempts})
        if unique_ids:
            cr = col.get(ids=unique_ids, include=["documents", "metadatas"])
            text_map = dict(zip(cr["ids"], cr["documents"]))
            meta_map = dict(zip(cr["ids"], cr["metadatas"]))
        else:
            text_map, meta_map = {}, {}

        history = []
        for a in attempts:
            meta = meta_map.get(a.question_id, {})
            img  = meta.get("image_path", "")
            history.append({
                "question_id":   a.question_id,
                "question_text": text_map.get(a.question_id, ""),
                "skill":         a.skill,
                "domain":        a.domain,
                "is_correct":    a.is_correct,
                "chosen_answer": a.chosen_answer,
                "correct_answer": meta.get("correct_answer", ""),
                "choices":       json.loads(meta.get("choices", "[]")),
                "explanation":   meta.get("explanation", ""),
                "image_url":     f"{_IMAGE_BASE}/{img}" if img else None,
                "created_at":    a.created_at.isoformat(),
            })

        skill_stats  = _skill_breakdown(attempts)
        domain_stats = _domain_breakdown(attempts)
        total   = len(attempts)
        correct = sum(1 for a in attempts if a.is_correct)

        return {
            "user_id":   user.id,
            "username":  user.username,
            "attempted": total,
            "correct":   correct,
            "accuracy":  round(correct / total * 100) if total else 0,
            "history":   history,
            "by_skill":  {
                s: {**v, "accuracy": round(v["correct"] / v["total"] * 100)}
                for s, v in sorted(skill_stats.items(), key=lambda x: x[1]["total"], reverse=True)
            },
            "by_domain": {
                d: {**v, "accuracy": round(v["correct"] / v["total"] * 100)}
                for d, v in sorted(domain_stats.items(), key=lambda x: x[1]["total"], reverse=True)
            },
        }
    finally:
        db.close()


# ── AI Explanation ────────────────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    question_text:  str
    choices:        list[str]
    correct_answer: str
    chosen_answer:  Optional[str] = None
    skill:          str
    domain:         str


def _build_explain_prompt(r: ExplainRequest) -> str:
    is_mc     = bool(r.choices)
    got_right = r.chosen_answer == r.correct_answer if r.chosen_answer else None

    choices_block = ""
    if is_mc:
        labels = ["A", "B", "C", "D"]
        lines  = [f"  {labels[i]}) {c.replace(f'{labels[i]}) ', '')}" for i, c in enumerate(r.choices)]
        choices_block = "\n".join(lines)

    if r.chosen_answer and not got_right:
        result_line = f"The student chose **{r.chosen_answer}**, which is incorrect. The correct answer is **{r.correct_answer}**."
    elif got_right:
        result_line = f"The student correctly chose **{r.correct_answer}**."
    else:
        result_line = f"The correct answer is **{r.correct_answer}**."

    wrong_instruction = (
        "\n- Explain specifically *why* the student's choice seemed plausible but is wrong — "
        "identify the likely reasoning mistake without being harsh."
    ) if r.chosen_answer and not got_right else ""

    return f"""You are an encouraging, expert SAT tutor. A student just answered a {r.domain} question.

**Skill tested:** {r.skill}

**Question:**
{r.question_text}
{"**Choices:**" + chr(10) + choices_block if is_mc else ""}

{result_line}

Write a helpful tutor explanation in 2–4 short paragraphs:
- Open by naming the core concept this question tests and why it trips students up
- Walk through *why* the correct answer is right, step by step
{wrong_instruction}
- Close with a concise tip or pattern the student can apply to similar questions

Be conversational, clear, and encouraging. Do not repeat the question word for word."""


@app.post("/explain")
def explain(body: ExplainRequest, _user: dict = Depends(require_user)):
    """Stream a Claude tutor explanation for a question."""
    prompt = _build_explain_prompt(body)

    def _stream():
        with _claude.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield text

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


# ── Drop-in any question ──────────────────────────────────────────────────────

_KNOWN_SKILLS = [
    # Algebra
    "Linear functions", "Linear equations in one variable",
    "Linear equations in two variables", "Systems of two linear equations in two variables",
    "Linear inequalities in one or two variables",
    # Advanced Math
    "Nonlinear functions", "Equivalent expressions",
    "Nonlinear equations in one variable and systems of equations in two variables",
    # Geometry and Trigonometry
    "Right triangles and trigonometry", "Area and volume", "Circles",
    "Lines, angles, and triangles",
    # Problem-Solving and Data Analysis
    "Percentages", "Ratios, rates, proportional relationships, and units",
    "Probability and conditional probability",
    "One-variable data: Distributions and measures of center and spread",
    "Two-variable data: Models and scatterplots",
    "Evaluating statistical claims: Observational studies and experiments",
    # Standard English Conventions
    "Boundaries", "Form, Structure, and Sense",
    # Craft and Structure
    "Words in Context", "Cross-Text Connections", "Text Structure and Purpose",
    # Expression of Ideas
    "Rhetorical Synthesis", "Transitions",
    # Information and Ideas
    "Central Ideas and Details", "Command of Evidence", "Inferences",
]

_KNOWN_DOMAINS = [
    "Algebra", "Advanced Math", "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry", "Standard English Conventions", "Expression of Ideas",
    "Craft and Structure", "Information and Ideas",
]

_DROP_IN_SYSTEM = f"""You are an SAT question analyst. Given a question (as text and/or image),
extract its content and classify it.

Return ONLY a JSON object with exactly these keys:
{{
  "question_text": "complete question stem",
  "choices": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer": "",
  "skill": "one of the exact skill names listed",
  "domain": "one of the domains listed below"
}}

Known skills: {", ".join(_KNOWN_SKILLS)}

Known domains: {", ".join(_KNOWN_DOMAINS)}

Rules:
- choices is [] for grid-in / student-produced response questions
- correct_answer is "" if the answer is not shown
- Match skill to the closest known skill
- Match domain to the appropriate domain
- Return ONLY the JSON, no other text"""


class DropInRequest(BaseModel):
    text:             Optional[str] = None
    image_b64:        Optional[str] = None
    image_media_type: str           = "image/png"


class DropInResult(BaseModel):
    question_text:  str
    choices:        list[str]
    correct_answer: str
    skill:          str
    domain:         str
    similar:        list[SimilarItem]


@app.post("/drop-in", response_model=DropInResult)
def drop_in(body: DropInRequest, _user: dict = Depends(require_user)):
    """Analyse any SAT question (text or image) and return similar bank questions."""
    if not body.text and not body.image_b64:
        raise HTTPException(status_code=400, detail="Provide text or an image")

    # Build the user message content
    content: list[dict] = []
    if body.image_b64:
        # Guard against excessively large payloads (~1.5MB base64 ≈ 1MB image)
        if len(body.image_b64) > 1_500_000:
            raise HTTPException(status_code=413, detail="Image too large — please use a smaller screenshot")
        content.append({
            "type": "image",
            "source": {
                "type":       "base64",
                "media_type": body.image_media_type,
                "data":       body.image_b64,
            },
        })
    if body.text:
        content.append({"type": "text", "text": body.text})
    else:
        content.append({"type": "text", "text": "Extract and classify the SAT question shown in the image."})

    # Ask Claude to parse the question
    try:
        resp = _claude.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_DROP_IN_SYSTEM,
            messages=[{"role": "user", "content": content}],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)[:200]}")

    import re as _re
    raw = resp.content[0].text.strip()
    raw = _re.sub(r"^```(?:json)?\s*", "", raw)
    raw = _re.sub(r"\s*```\s*$",       "", raw)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail=f"Could not parse question from response: {raw[:200]}")

    skill  = parsed.get("skill",  _KNOWN_SKILLS[0])
    domain = parsed.get("domain", _KNOWN_DOMAINS[0])

    # Combine question text and choices for embedding, matching database approach
    q_text = parsed.get("question_text", body.text or "")
    q_choices = parsed.get("choices", [])
    text_for_embedding = " ".join([q_text] + q_choices) if q_choices else q_text

    # Find similar questions from the bank
    similar_results = find_similar_for_text(
        question_text=text_for_embedding,
        skill=skill,
        domain=domain,
    )

    similar_items = [
        SimilarItem(
            id=r.id,
            question_text=r.question_text,
            domain=r.domain,
            skill=r.skill,
            difficulty=r.difficulty,
            source=r.source,
            choices=r.choices,
            correct_answer=r.correct_answer,
            explanation=r.explanation,
            image_url=f"{_IMAGE_BASE}/{r.image_path}" if r.image_path else None,
            distance=r.distance,
            fallback_used=r.fallback_used,
        )
        for r in similar_results
    ]

    return DropInResult(
        question_text=parsed.get("question_text", ""),
        choices=parsed.get("choices", []),
        correct_answer=parsed.get("correct_answer", ""),
        skill=skill,
        domain=domain,
        similar=similar_items,
    )
