"""Embedding generation via sentence-transformers (local, no external API)."""
from __future__ import annotations
from sentence_transformers import SentenceTransformer

_MODEL_NAME = "all-MiniLM-L6-v2"
_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        print(f"Loading embedding model '{_MODEL_NAME}'…")
        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def _question_to_text(q: dict) -> str:
    """Concatenate question text and choices for richer embedding."""
    parts = [q["question_text"]]
    if q.get("choices"):
        parts.extend(q["choices"])
    return " ".join(parts)


def embed_text(text: str) -> list[float]:
    """Embed a single string and return the vector."""
    return _get_model().encode(text, normalize_embeddings=True).tolist()


def embed_batch(questions: list[dict]) -> list[dict]:
    """Add an 'embedding' list[float] to each question dict (mutates in place)."""
    model = _get_model()
    texts = [_question_to_text(q) for q in questions]
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
    for q, vec in zip(questions, vecs):
        q["embedding"] = vec.tolist()
    return questions
