"""
Crop per-question images from hard expression of ideas.pdf and update ChromaDB.

Usage:
    python crop_expression_of_ideas.py
"""
from __future__ import annotations
import json
from pathlib import Path

from ingestion.extract import find_question_pages, save_question_crops
from ingestion.load import get_collection

PDF_PATH   = Path("data/pdfs/hard expression of ideas.pdf")
OUTPUT_DIR = Path("data/structured/images/expression_of_ideas_hard")
COLLECTION_NAME = "sat_questions"

# All MC (all Expression of Ideas questions have 4 choices)
ALL_IDS = {
    "4e564c4f", "d3888864", "29f5d8bd", "59aa305b", "dffab2d7",
    "990bd995", "9dcc184d", "aba812aa", "33a93756", "f99639a1",
    "c6b6128f", "1572e3e1", "8f3ad8e1", "867ceff8", "cd75bd44",
    "21f19050", "9579edb4", "c5423706", "5efdc098", "bcb73490",
    "e261a81f", "0a6b66b3", "afc8b561", "6be089ec", "9db9a861",
    "a2941bd8", "d600f35e", "004680af", "857346cd", "38a981d0",
    "781e8f5c", "5bb70279", "b8582018", "c9ecaf7d", "0d9560e0",
    "140d2d15",
}


def main():
    if not PDF_PATH.exists():
        print(f"ERROR: PDF not found at {PDF_PATH}")
        print("Save 'hard expression of ideas.pdf' to data/pdfs/ first.")
        return

    import fitz
    doc = fitz.open(str(PDF_PATH))
    pages_raw = []
    for page in doc:
        pages_raw.append({"page_num": page.number + 1, "text": page.get_text()})
    doc.close()

    page_map = find_question_pages(pages_raw)
    found = {qid: pn for qid, pn in page_map.items() if qid in ALL_IDS}
    print(f"Found {len(found)}/{len(ALL_IDS)} question IDs in PDF.")

    print("Cropping question images…")
    crops = save_question_crops(PDF_PATH, found, OUTPUT_DIR, scale=2.5, mc_ids=ALL_IDS)
    print(f"Saved {len(crops)} crops to {OUTPUT_DIR}/")

    # Update ChromaDB image_path metadata for each cropped question
    col = get_collection()
    for qid, fname in crops.items():
        image_path = f"expression_of_ideas_hard/{fname}"
        r = col.get(ids=[qid], include=["metadatas", "documents", "embeddings"])
        if not r["ids"]:
            print(f"  WARNING: {qid} not found in ChromaDB, skipping")
            continue
        meta = r["metadatas"][0]
        meta["image_path"] = image_path
        col.update(
            ids=[qid],
            metadatas=[meta],
        )
        print(f"  Updated {qid} → {image_path}")

    print(f"\nDone. Updated {len(crops)} records.")


if __name__ == "__main__":
    main()
