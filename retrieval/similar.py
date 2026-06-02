"""
Hybrid similar-question retrieval.

Pattern (per SPEC):
  1. Hard-filter candidates to same skill + difficulty band.
  2. Rank within that pool by embedding cosine distance.
  3. Exclude the source question; return top n.
  4. Fallback: if filtered pool < MIN_POOL, loosen skill → domain.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field

import chromadb

from ingestion.load import CHROMA_PATH, COLLECTION_NAME
from ingestion.embed import embed_text

_DIFFICULTY_BAND: dict[str, list[str]] = {
    "Hard":   ["Hard", "Medium"],
    "Medium": ["Easy", "Medium", "Hard"],
    "Easy":   ["Easy", "Medium"],
}

MIN_POOL = 3  # minimum candidates before triggering domain fallback


@dataclass
class SimilarResult:
    id: str
    question_text: str
    domain: str
    skill: str
    difficulty: str
    source: str
    correct_answer: str
    choices: list[str]
    explanation: str
    image_path: str
    distance: float          # cosine distance — lower is more similar
    fallback_used: bool = False


def find_similar(
    question_id: str,
    n: int = 3,
    chroma_path: str = CHROMA_PATH,
) -> list[SimilarResult]:
    """Return the top-n most similar questions to the given question ID."""
    col = _get_collection(chroma_path)

    # --- fetch source ---
    src = col.get(ids=[question_id], include=["embeddings", "metadatas"])
    if not src["ids"]:
        raise ValueError(f"Question {question_id!r} not found")

    src_embedding = src["embeddings"][0]
    src_meta      = src["metadatas"][0]
    src_skill      = src_meta["skill"]
    src_domain     = src_meta["domain"]
    difficulty_band = _DIFFICULTY_BAND.get(src_meta["difficulty"], [src_meta["difficulty"]])

    # --- skill-level query ---
    results = _query(col, src_embedding, question_id, n,
                     where=_where(skill=src_skill, difficulties=difficulty_band))

    # --- domain fallback ---
    fallback = len(results) < MIN_POOL
    if fallback:
        results = _query(col, src_embedding, question_id, n,
                         where=_where(domain=src_domain, difficulties=difficulty_band))
        for r in results:
            r.fallback_used = True

    return results[:n]


def find_similar_for_text(
    question_text: str,
    skill: str,
    domain: str,
    n: int = 3,
    chroma_path: str = CHROMA_PATH,
) -> list[SimilarResult]:
    """Find similar questions for arbitrary (non-bank) question text."""
    col        = _get_collection(chroma_path)
    embedding  = embed_text(question_text)
    all_diffs  = ["Hard", "Medium", "Easy"]

    results = _query(col, embedding, "", n,
                     where=_where(skill=skill, difficulties=all_diffs))
    if len(results) < MIN_POOL:
        results = _query(col, embedding, "", n,
                         where=_where(domain=domain, difficulties=all_diffs))
        for r in results:
            r.fallback_used = True

    return results[:n]


# ── helpers ──────────────────────────────────────────────────────────────────

def _get_collection(chroma_path: str) -> chromadb.Collection:
    client = chromadb.PersistentClient(path=chroma_path)
    return client.get_collection(COLLECTION_NAME)


def _where(
    skill: str | None = None,
    domain: str | None = None,
    difficulties: list[str] | None = None,
) -> dict | None:
    conditions: list[dict] = []
    if skill:
        conditions.append({"skill": {"$eq": skill}})
    elif domain:
        conditions.append({"domain": {"$eq": domain}})
    if difficulties:
        if len(difficulties) == 1:
            conditions.append({"difficulty": {"$eq": difficulties[0]}})
        else:
            conditions.append({"difficulty": {"$in": difficulties}})
    if not conditions:
        return None
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


def _query(
    col: chromadb.Collection,
    embedding: list[float],
    exclude_id: str,
    n: int,
    where: dict | None,
) -> list[SimilarResult]:
    # Ask for one extra in case the source question is in the results
    n_request = min(n + 1, col.count())

    kwargs: dict = dict(
        query_embeddings=[embedding],
        n_results=n_request,
        include=["metadatas", "documents", "distances"],
    )
    if where:
        kwargs["where"] = where

    try:
        r = col.query(**kwargs)
    except Exception:
        return []

    out: list[SimilarResult] = []
    for qid, doc, meta, dist in zip(
        r["ids"][0], r["documents"][0], r["metadatas"][0], r["distances"][0]
    ):
        if qid == exclude_id:
            continue
        out.append(SimilarResult(
            id=qid,
            question_text=doc,
            domain=meta["domain"],
            skill=meta["skill"],
            difficulty=meta["difficulty"],
            source=meta["source"],
            correct_answer=meta["correct_answer"],
            choices=json.loads(meta["choices"]),
            explanation=meta["explanation"],
            image_path=meta.get("image_path") or "",
            distance=round(dist, 4),
        ))

    return out
