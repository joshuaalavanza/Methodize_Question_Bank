"""Claude API structuring pass: raw EQB PDF → list of question dicts.

Uses vision mode: sends 1× page images alongside extracted text in batches of
BATCH_SIZE pages so each API call stays well within output token limits.
"""
from __future__ import annotations
import base64
import json
import os
import re
import anthropic
from json_repair import repair_json
from dotenv import load_dotenv

load_dotenv()

_client: anthropic.Anthropic | None = None
BATCH_SIZE = 10   # pages per Claude call → ~10 questions, well under 8K output tokens


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


_SYSTEM = """You are a precise data-extraction assistant parsing College Board SAT \
Educator Question Bank (EQB) PDF exports.

You will receive rendered PDF page images and the extracted text for a batch of pages. \
Use BOTH: the images let you read equations and figures accurately; the text provides structure.

Each question follows this layout:
  1. "Question ID <8hex>" — College Board question identifier
  2. Metadata table: Assessment | Test | Domain | Skill | Difficulty
  3. "ID: <8hex>" then the question body (may include equations, tables, figures)
  4. Answer choices A. B. C. D.  (absent for student-produced response / grid-in)
  5. "ID: <8hex> Answer" → "Correct Answer: <value>" → Rationale text
  6. "Question Difficulty: Hard|Medium|Easy"

Return a JSON array of ALL questions that START on the pages provided. \
Each element must have exactly these keys:

  id              — the 8-character hex Question ID (e.g. "43e69f94")
  question_text   — full problem statement; render equations in plain text using \
^ for exponents, sqrt() for square roots, / for fractions; reproduce tables as \
plain-text rows; write [Figure] where a graph appears
  choices         — ["A) ...", "B) ...", "C) ...", "D) ..."] for MC; [] for grid-in
  correct_answer  — "A"/"B"/"C"/"D" for MC; primary numeric value for grid-in \
(e.g. "515", "-49/150"); take the first form when multiple are listed
  explanation     — full Rationale text, preserving all steps and math
  domain          — College Board domain from the metadata table \
(e.g. "Algebra", "Advanced Math", "Problem-Solving and Data Analysis", \
"Geometry and Trigonometry")
  skill           — exact College Board skill tag from the metadata table
  difficulty      — "Easy", "Medium", or "Hard"

Rules:
- Extract every question that begins in this batch. Do not skip any.
- grid-in choices must be [].
- Use "" for any field genuinely absent. Never invent values.
- Return only the JSON array. No markdown fences, no commentary."""


def structure_pdf(
    raw_text: str,
    domain: str,
    page_images: list[bytes] | None = None,
) -> list[dict]:
    """
    Parse an EQB PDF export into structured question dicts.
    Splits into batches of BATCH_SIZE pages; merges and deduplicates by id.
    """
    if page_images is None:
        return _call_claude(raw_text, domain, [])

    page_texts = raw_text.split("---PAGE BREAK---")
    n = len(page_images)
    all_questions: dict[str, dict] = {}   # id → question (dedup across batches)

    for start in range(0, n, BATCH_SIZE):
        end = min(start + BATCH_SIZE, n)
        batch_imgs  = page_images[start:end]
        batch_text  = "---PAGE BREAK---".join(page_texts[start:end])
        print(f"    pages {start+1}–{end}…", end=" ", flush=True)
        batch_qs = _call_claude(batch_text, domain, batch_imgs)
        print(f"{len(batch_qs)} questions")
        for q in batch_qs:
            all_questions[q["id"]] = q   # last write wins on overlap

    return list(all_questions.values())


def _call_claude(text: str, domain: str, images: list[bytes]) -> list[dict]:
    client = _get_client()

    content: list[dict] = []
    for img_bytes in images:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": base64.b64encode(img_bytes).decode(),
            },
        })
    content.append({
        "type": "text",
        "text": (
            f"Domain: {domain}\n\n"
            + ("Extracted text (use images above for equations/figures):\n\n" if images else "")
            + text
        ),
    })

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=[{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": content}],
    )

    if response.stop_reason == "max_tokens":
        raise RuntimeError(
            "Output truncated — reduce BATCH_SIZE or check for unusually long explanations."
        )

    raw = response.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```\s*$", "", raw)

    try:
        questions: list[dict] = json.loads(raw)
    except json.JSONDecodeError:
        # Grammar explanations often contain unescaped quotes — try repair first
        try:
            questions = json.loads(repair_json(raw))
        except Exception as exc:
            raise ValueError(f"JSON parse failed even after repair: {exc}") from exc

    return questions if isinstance(questions, list) else []
