"""PDF text and image extraction via PyMuPDF."""
from __future__ import annotations
from pathlib import Path
import fitz  # PyMuPDF


def extract_pages(pdf_path: Path) -> list[dict]:
    """Return one dict per page with text and a 2× PNG for saved diagnostics."""
    doc = fitz.open(str(pdf_path))
    pages = []
    for page in doc:
        text = page.get_text()
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        pages.append({
            "page_num": page.number + 1,
            "text": text,
            "image_bytes": pix.tobytes("png"),
        })
    doc.close()
    return pages


def vision_images(pdf_path: Path) -> list[bytes]:
    """Render each page at 1× zoom — small enough for Claude vision (≈3.5k tokens/page)."""
    doc = fitz.open(str(pdf_path))
    imgs = []
    for page in doc:
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
        imgs.append(pix.tobytes("png"))
    doc.close()
    return imgs


def full_text(pages: list[dict]) -> str:
    """Concatenate page text with visible page-break markers."""
    return "\n\n---PAGE BREAK---\n\n".join(p["text"] for p in pages)


def save_images(pages: list[dict], output_dir: Path) -> None:
    """Write one PNG per page — kept alongside any diagram-bearing questions."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for p in pages:
        (output_dir / f"page_{p['page_num']:03d}.png").write_bytes(p["image_bytes"])


def find_question_pages(pages: list[dict]) -> dict[str, int]:
    """Return {question_id: page_num} by scanning each page's text."""
    import re
    mapping: dict[str, int] = {}
    for p in pages:
        m = re.search(r"Question ID\s+([0-9a-f]{8})", p["text"], re.IGNORECASE)
        if m:
            mapping[m.group(1).lower()] = p["page_num"]
    return mapping


def save_question_crops(
    pdf_path: Path,
    question_page_map: dict[str, int],
    output_dir: Path,
    scale: float = 2.5,
    mc_ids: set[str] | None = None,
) -> dict[str, str]:
    """
    Render a cropped image for each question.
    - MC questions: crop stops just above the first answer choice ("A.")
    - Grid-in questions: crop stops just above the answer section
    Returns {question_id: filename}.
    """
    doc = fitz.open(str(pdf_path))
    output_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, str] = {}

    for qid, page_num in question_page_map.items():
        page = doc[page_num - 1]
        w, h = page.rect.width, page.rect.height

        # TOP: start just below the "ID: <hex>" label (skips header + metadata table)
        top_hits = page.search_for(f"ID: {qid}", quads=False)
        crop_top = top_hits[0].y1 + 14 if top_hits else 0

        # BOTTOM: just above the "ID: <hex> Answer" header.
        # If the answer section is on the next page, fall back to the full page
        # height so multi-page questions (graph + passage + stem) aren't clipped.
        ans_hits = page.search_for(f"ID: {qid} Answer", quads=False)
        if ans_hits:
            crop_bottom = ans_hits[0].y0 - 8
        else:
            hits2 = page.search_for("Correct Answer:")
            crop_bottom = hits2[0].y0 - 8 if hits2 else h

        # MC: tighten bottom to just above the first "A." answer choice.
        # Strategy: find the first B. in range that has an A. just above it
        # within 150pt. Iterating rather than taking only the topmost B. avoids
        # false matches from passage text like "Napoleon B. Johnson" which has no
        # A. before it but would otherwise block the real A./B. choice pair.
        if mc_ids is None or qid in mc_ids:
            a_hits = page.search_for("A.", quads=False)
            b_hits = page.search_for("B.", quads=False)
            in_range_a = [r for r in a_hits if crop_top < r.y0 < crop_bottom]
            in_range_b = [r for r in b_hits if crop_top < r.y0 < crop_bottom]
            for b_rect in sorted(in_range_b, key=lambda r: r.y0):
                above_b = [r for r in in_range_a if r.y0 < b_rect.y0]
                if not above_b:
                    continue
                closest_a = max(above_b, key=lambda r: r.y0)
                if b_rect.y0 - closest_a.y0 < 150:
                    candidate = closest_a.y0 - 6
                    if candidate - crop_top > 20:
                        crop_bottom = candidate
                    break

        # Skip if crop region is empty or too small to render
        if crop_bottom - crop_top < 10:
            continue

        clip = fitz.Rect(0, crop_top, w, crop_bottom)
        pix  = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip)
        fname = f"q_{qid}.png"
        pix.save(str(output_dir / fname))
        result[qid] = fname

    doc.close()
    return result
