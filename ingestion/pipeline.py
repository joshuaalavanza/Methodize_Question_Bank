"""
Ingestion pipeline CLI.

Usage:
    python -m ingestion.pipeline path/to/algebra_batch.pdf
    python -m ingestion.pipeline path/to/algebra_batch.pdf --domain Algebra --source EQB
    python -m ingestion.pipeline data/pdfs/*.pdf --domain Algebra

Outputs:
    data/structured/<stem>.jsonl   — one JSON record per line
    data/images/<stem>/page_NNN.png — page images for spot-checking diagrams
"""
from __future__ import annotations
import json
import uuid
from pathlib import Path

import click

from .extract import extract_pages, full_text, save_images, vision_images, find_question_pages, save_question_crops
from .structure import structure_pdf
from .embed import embed_batch


def _run_one(pdf_path: Path, domain: str, source: str, output_dir: Path) -> list[dict]:
    images_dir = output_dir / "images" / pdf_path.stem
    out_file = output_dir / f"{pdf_path.stem}.jsonl"

    print(f"\n=== {pdf_path.name} ===")
    print("  Extracting pages…")
    pages = extract_pages(pdf_path)
    print(f"  Saving {len(pages)} page images to {images_dir}")
    save_images(pages, images_dir)

    raw = full_text(pages)
    print(f"  Rendering 1× vision images ({len(pages)} pages)…")
    imgs = vision_images(pdf_path)

    print(f"  Structuring with Claude vision ({len(raw):,} chars + {len(imgs)} images)…")
    questions = structure_pdf(raw, domain, page_images=imgs)
    print(f"  Parsed {len(questions)} questions")

    print("  Cropping question images…")
    page_map   = find_question_pages(pages)
    mc_ids     = {q["id"] for q in questions if q.get("choices")}
    crop_names = save_question_crops(pdf_path, page_map, images_dir, mc_ids=mc_ids)

    for q in questions:
        # Preserve the College Board Question ID if Claude extracted it; fall back to UUID.
        if not q.get("id"):
            q["id"] = str(uuid.uuid4())
        # Use Claude-extracted domain if present; fall back to --domain argument
        if not q.get("domain"):
            q["domain"] = domain
        q["source"] = source
        fname = crop_names.get(q["id"])
        q["image_path"] = f"{pdf_path.stem}/{fname}" if fname else None

    print("  Embedding…")
    embed_batch(questions)

    output_dir.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as f:
        for q in questions:
            f.write(json.dumps(q, ensure_ascii=False) + "\n")
    print(f"  Wrote {len(questions)} records -> {out_file}")
    return questions


@click.command()
@click.argument("pdf_paths", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--domain", default="Algebra", show_default=True,
              help="College Board domain label applied to all records.")
@click.option("--source", default="EQB", show_default=True,
              type=click.Choice(["EQB", "hard_set"]),
              help="Question source.")
@click.option("--output-dir", default="data/structured", show_default=True,
              type=click.Path(path_type=Path),
              help="Directory for .jsonl output and page images.")
def main(pdf_paths: tuple[Path, ...], domain: str, source: str, output_dir: Path):
    """Ingest one or more EQB PDF exports into structured JSONL with embeddings."""
    total = 0
    for pdf in pdf_paths:
        qs = _run_one(pdf, domain, source, output_dir)
        total += len(qs)
    print(f"\nDone. {total} total questions across {len(pdf_paths)} file(s).")


if __name__ == "__main__":
    main()
