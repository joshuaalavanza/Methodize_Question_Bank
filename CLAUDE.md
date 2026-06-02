# CLAUDE.md — Quarry

Persistent context for Claude Code. Loaded automatically each session. Keep this short and durable; the full plan lives in `SPEC.md`.

## What this is
Quarry is an internal SAT-prep tool for a small tutoring company. Tutors and students browse a bank of real SAT math problems, filter by topic and difficulty, and get recommended "similar questions" for any problem. The recommendation feature is the centerpiece — it automates what tutors do by hand all day ("find me more like this one").

## Stack
- **Backend:** Python, FastAPI
- **Vector store:** ChromaDB (single store for the demo — holds embeddings + filterable metadata)
- **LLM:** Claude API (for ingestion structuring/tagging; not in the live request path for v1)
- **Frontend:** single-page React app talking to FastAPI
- Containerized with Docker; CI/CD as the project matures

## Core design principles (do not drift from these)
1. **Two retrieval modes, kept separate.** Filtering by topic/difficulty is a pure metadata query — no embeddings. "Recommend similar" is the only part that uses vector search.
2. **Metadata filtering leads; embeddings refine.** Math questions embed poorly — two problems on the same concept can read completely differently, and two similar-looking problems can test different skills. So similarity search ALWAYS hard-filters to the same skill (and a difficulty band) first, then ranks by embedding distance *within* that bucket. Never let pure vector similarity decide "same skill."
3. **One taxonomy across both sources.** EQB questions arrive tagged; the separate hard-problem PDF does not. Normalize everything to the official College Board skill taxonomy so both sources share one vocabulary.
4. **Build order discipline.** Always keep something working. Prove the riskiest layer (ingestion of one domain) before building outward.

## Build order
1. Ingestion on ONE domain (SAT Algebra) → clean JSON. Riskiest step (math extraction), so prove it first.
2. Load into ChromaDB; confirm filter queries return correct questions.
3. Build `/similar` retrieval; eyeball whether recommendations actually feel similar; tune filter-vs-embedding balance.
4. Wrap in FastAPI.
5. Minimal React UI.
6. Expand ingestion to remaining math domains; fold in the separate hard-problem PDF.

## Watch out for
- Math/equations and figures do not survive plain PDF text extraction cleanly — spot-check every ingestion batch. Questions with diagrams may need a page image kept alongside the text.
- Copyright: College Board questions are copyrighted. Fine as an internal aid mirroring how tutors already use the material; flag licensing proactively if productizing/distribution ever comes up. (Not legal advice.)
- Use only the sanctioned manual PDF export from the Educator Question Bank. Do not scrape its endpoints programmatically.
