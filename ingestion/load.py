"""
Load structured JSONL records into ChromaDB.

Usage:
    python -m ingestion.load data/structured/algebra_hard_linear.jsonl
    python -m ingestion.load data/structured/*.jsonl   # add more batches later
"""
from __future__ import annotations
import json
from pathlib import Path

import chromadb
import click

CHROMA_PATH = "data/chroma"
COLLECTION_NAME = "sat_questions"


def get_collection(chroma_path: str = CHROMA_PATH) -> chromadb.Collection:
    client = chromadb.PersistentClient(path=chroma_path)
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def load_jsonl(jsonl_path: Path, collection: chromadb.Collection) -> int:
    records = [json.loads(line) for line in jsonl_path.open(encoding="utf-8")]

    ids, embeddings, documents, metadatas = [], [], [], []
    for r in records:
        ids.append(r["id"])
        embeddings.append(r["embedding"])
        documents.append(r["question_text"])
        metadatas.append({
            "domain": r["domain"],
            "skill": r["skill"],
            "difficulty": r["difficulty"],
            "source": r["source"],
            "correct_answer": r["correct_answer"],
            # Serialise list fields — ChromaDB metadata must be str/int/float/bool
            "choices": json.dumps(r["choices"]),
            "explanation": r["explanation"],
            # None is not allowed in ChromaDB metadata; use "" when unknown
            "calculator_allowed": r.get("calculator_allowed") or "",
            "image_path": r.get("image_path") or "",
        })

    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )
    return len(records)


@click.command()
@click.argument("jsonl_paths", nargs=-1, required=True,
                type=click.Path(exists=True, path_type=Path))
@click.option("--chroma-path", default=CHROMA_PATH, show_default=True)
def main(jsonl_paths: tuple[Path, ...], chroma_path: str):
    """Upsert one or more JSONL batches into ChromaDB."""
    collection = get_collection(chroma_path)
    total = 0
    for path in jsonl_paths:
        n = load_jsonl(path, collection)
        print(f"  Loaded {n} records from {path.name}")
        total += n
    print(f"\nCollection '{COLLECTION_NAME}' now has {collection.count()} total records.")


if __name__ == "__main__":
    main()
