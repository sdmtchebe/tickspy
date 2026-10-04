# TickSPY — marketing site + trading desk

One repository holding both halves of TickSPY:

```
frontend/   React 19 (CRA + craco) marketing landing page — the website
backend/    FastAPI contact/feedback API (MongoDB + email)
desk/       The actual trading helper: a self-contained desk UI (index.html)
            served by its own Python server (server.py) with an optional
            two-stage volatility model (volatility_predictor.py)
```

Pressing **Open App** on the website opens the desk at `/desk/index.html`
(bundled from `desk/index.html`). The desk page then talks to the local desk
server for its market-data proxy and volatility model.

## How the two connect

- `frontend/scripts/sync-desk.js` copies `desk/index.html` into
  `frontend/public/desk/` before `yarn start` and `yarn build`. `public/desk/`
  is generated and git-ignored, so `desk/index.html` stays the single source.
- `frontend/src/lib/site.js` `openApp()` opens `/desk/index.html` in a new tab.
  Set `REACT_APP_DESK_PATH` to a full URL to point it at a desk hosted
  elsewhere.
- The desk page detects how it was served: from its own Python server
  (`http://localhost:8000`) it uses same-origin endpoints; served from the
  website it targets `http://localhost:8000` cross-origin. Override with
  `window.DESK_API_BASE` if needed.
- `desk/server.py` answers CORS preflights so the website's origin can reach
  the local API. It still refuses to bind to a non-local address unless
  `ALLOW_PUBLIC=1`, per its data-provider terms.

## Running locally

**Website** (port 3000):

```bash
cd frontend
yarn install
yarn start
```

**Trading desk** (port 8000) — start this too, or the desk has no live data:

```bash
cd desk
python3 server.py            # then open http://localhost:8000
```

With both running, click **Open App** on the website: the desk opens in a new
tab and its data comes from the local server. The desk needs Alpaca API keys
and (optionally) a Gemini key or a local model; enter them in its **Settings**
tab. Keys are stored in the browser only.

**Backend API** (contact/feedback forms):

```bash
cd backend
python -m pytest             # tests
uvicorn server:app --reload  # run
```

See `backend/.env` for `MONGO_URL`, `DB_NAME` and related settings.

## Notes

- `.env` files and `desk/local-config.js` hold secrets and are git-ignored.
- Market data is licensed for personal, non-commercial use — see
  `desk/DISCLAIMER.md`. Do not deploy the desk in a way that redistributes it.
- `memory/PRD.md` tracks product decisions for the landing page.
