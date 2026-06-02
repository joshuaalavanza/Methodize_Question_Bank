# Quarry — SAT Prep Tool

An internal SAT-prep application for tutors and students. Browse a bank of real SAT math and reading questions, filter by topic/difficulty, and get AI-powered recommendations for similar questions.

## Quick Start (macOS)

### Prerequisites
- Python 3.11+
- Node.js 18+
- ~2GB disk space

### Setup

```bash
# Clone the repo
git clone <your-repo-url>
cd SatProject

# Backend setup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend setup
cd frontend
npm install
cd ..
```

### Run the App

**Terminal 1 — Backend (FastAPI on localhost:8000)**
```bash
source .venv/bin/activate
python -m uvicorn api.main:app --reload
```

**Terminal 2 — Frontend (React on localhost:5173)**
```bash
cd frontend
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Features

- **Browse Questions:** Filter by subject (Math/English), domain, skill, difficulty
- **Drop In Any Question:** Paste a question (text or screenshot) to get AI-powered recommendations
- **Similar Question Finder:** "Find more like this" for any question
- **Student Progress Tracking:** Track attempts, accuracy, and weak skills
- **Admin Dashboard:** View student performance (requires admin auth)

## Data

- **319 hard-difficulty questions** across all SAT domains
- **Cropped PDF images** for every question
- **Vector embeddings** for intelligent similarity search
- **ChromaDB** persistent vector store

## Tech Stack

- **Backend:** Python, FastAPI, ChromaDB, Claude API
- **Frontend:** React, Vite
- **Embeddings:** sentence-transformers (all-MiniLM-L6-v2)
- **Database:** ChromaDB (local, persistent)

## Project Structure

```
.
├── api/                 # FastAPI backend
├── frontend/            # React SPA
├── ingestion/           # PDF extraction & structuring pipeline
├── retrieval/           # Vector similarity search
├── data/
│   ├── pdfs/           # Source PDFs
│   ├── structured/      # JSONL + images
│   └── chroma/         # Vector database
└── requirements.txt     # Python dependencies
```

## Development Notes

See `CLAUDE.md` for architectural decisions and `SPEC.md` for full feature spec.
