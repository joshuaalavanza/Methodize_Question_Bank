.PHONY: api frontend dev build

# ── Local dev (same network) ──────────────────────────────────────────────────

api:
	.venv/bin/uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "Starting API and frontend in parallel — Ctrl-C stops both"
	@trap 'kill 0' INT; \
	  .venv/bin/uvicorn api.main:app --reload --host 0.0.0.0 --port 8000 & \
	  cd frontend && npm run dev & \
	  wait

# ── Cross-network via ngrok ───────────────────────────────────────────────────
#
# 1. Install ngrok once:  brew install ngrok
# 2. Run in a separate terminal to get your public URL:
#      ngrok http 8000
# 3. Copy the https URL (e.g. https://abc123.ngrok-free.app) and run:
#      PUBLIC_BASE_URL=https://abc123.ngrok-free.app make ngrok
#
# Students can now join from any network — no shared WiFi needed.

build:
	cd frontend && npm run build

ngrok: build
	@if [ -z "$$PUBLIC_BASE_URL" ]; then \
	  echo "ERROR: set PUBLIC_BASE_URL to your ngrok https URL first"; \
	  echo "  e.g.  PUBLIC_BASE_URL=https://abc123.ngrok-free.app make ngrok"; \
	  exit 1; \
	fi
	@echo "Serving at $$PUBLIC_BASE_URL"
	PUBLIC_BASE_URL=$$PUBLIC_BASE_URL \
	  .venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
