# SPEC.md — Quarry

Full specification for Quarry, an internal SAT-prep retrieval tool for a small tutoring company. This is the design handoff: read alongside `CLAUDE.md`.

## Goal
Ingest a bank of real SAT math problems from two sources, let users filter by topic and difficulty, and recommend similar questions for any given problem. The "more like this" recommendation is the headline feature.

## Sources
1. **College Board Educator Question Bank (EQB).** Public, no account needed. Search + filter UI with PDF export (up to 20 questions at a time). Exports carry metadata: difficulty, primary/secondary/tertiary skill dimensions, calculator/no-calculator, answer choices, and answer explanations.
2. **A separate PDF of hard math problems.** Likely untagged; needs a tagging pass to match the EQB taxonomy.

Use only the sanctioned manual PDF export from the EQB — do not scrape its endpoints.

---

## 1. Ingestion pipeline (offline batch job — not part of the live app)

Both sources flow through one path into a shared schema:

```
PDF → text extraction → LLM structuring pass → normalized JSON record → embed → load into store(s)
```

- **Text extraction:** PyMuPDF or pdfplumber. Math/equations and figures are the failure point — spot-check every batch. Keep a page image alongside the text for diagram-bearing questions.
- **Structuring pass (Claude API):** turn each raw question block into a clean JSON record matching the schema below. The EQB format is consistent enough to parse reliably.
- **Tagging pass (separate PDF only):** map each problem to the official College Board skill taxonomy so both sources share one vocabulary. Spot-check a sample.
- Export the EQB in filtered batches: Math → hardest difficulty → one domain at a time (Algebra, Advanced Math, Problem-Solving & Data Analysis, Geometry & Trig). A few hundred problems is ~15–25 PDFs; each batch arrives pre-tagged by domain.

Run once; re-run only when adding questions.

---

## 2. Question record schema

```json
{
  "id": "string",
  "question_text": "string",
  "choices": ["string", ...],
  "correct_answer": "string",
  "explanation": "string",
  "domain": "string",          // e.g. Algebra
  "skill": "string",           // specific College Board skill tag
  "difficulty": "string",      // or numeric band
  "calculator_allowed": true,
  "source": "EQB | hard_set",  // distinguishes official vs. supplementary
  "embedding": [/* vector */]
}
```

Metadata fields drive filtering. The embedding drives similarity. `source` lets you favor or distinguish official vs. supplementary questions later.

---

## 3. Storage

- **Demo (start here):** ChromaDB alone. It holds embeddings plus a copy of the filterable metadata and supports metadata `where` filters on queries — one fewer moving part.
- **Later (only if browse needs it):** add a relational store (Postgres, or SQLite for a demo) for canonical records and fast exact browse/filter queries. Don't add this until the browse experience demands it.

---

## 4. Retrieval logic

**Filtering (browse):** straight metadata query — `WHERE domain = ? AND difficulty = ?`. No embeddings.

**Similar questions (the hybrid pattern):**
1. Given a source question, hard-filter the candidate pool to the same `skill` and a difficulty band around it.
2. Semantically rank that filtered pool by embedding distance to the source.
3. Drop the source question itself; return top 3.
4. **Fallback:** if the filtered pool is too thin, loosen skill → domain — never abandon the filter entirely.

The filter guarantees pedagogical relevance ("actually the same skill"); embeddings only pick the closest *within* that set. This ordering is deliberate because math questions embed poorly.

---

## 5. API layer (FastAPI)

Thin layer translating HTTP into store queries.

- `GET /questions` — filter params (topic, difficulty, calculator); returns the browse list.
- `GET /questions/{id}` — single question with choices, answer, explanation.
- `GET /questions/{id}/similar` — the recommendation; returns top 3 similar.
- `GET /filters` — available domains/skills/difficulties to populate UI dropdowns.

---

## 6. Frontend (single-page React app)

- Filter sidebar: topic, difficulty, calculator toggle.
- Results list.
- Question detail view: choices + correct answer + explanation.
- "More like this" button → hits `/similar`, renders the three results inline.

---

## 7. Build order

1. Ingestion on ONE domain (SAT Algebra) → clean JSON. Prove the math-extraction risk first.
2. Load into ChromaDB; confirm filter queries return correct questions.
3. Build `/similar`; eyeball recommendation quality; tune filter-vs-embedding balance.
4. Wrap in FastAPI.
5. Minimal React UI.
6. Expand ingestion to remaining domains; fold in the separate hard-problem PDF.

Each layer works before the next is added — a stuttering demo should be impossible.

---

## Cautions

- **Math extraction** is the riskiest part. Spot-check every batch; keep page images for diagrams.
- **Copyright:** College Board questions are copyrighted. Fine as an internal aid mirroring existing tutor use; raise licensing proactively if productizing/distribution comes up. Not legal advice.
- **No scraping** the EQB — manual PDF export only.
