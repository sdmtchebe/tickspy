# TickSPY — marketing site + trading desk

One repository holding both halves of TickSPY:

```
frontend/   React 19 (CRA + craco) marketing landing page — the website
backend/    FastAPI contact/feedback API (MongoDB + email)
desk/       The trading helper: a self-contained dashboard (index.html) with an
            optional local Python server and an in-browser volatility engine
```

The desk is published on its own at **https://sdmtchebe.github.io/tickspy/** —
no Python, nothing running locally. Pressing **Open App** on the website opens the
desk.

## How the two connect

- `frontend/scripts/sync-desk.js` copies `desk/index.html` and `desk/volmodel.js`
  into `frontend/public/desk/` before `yarn start` and `yarn build`. `public/desk/`
  is generated and git-ignored, so `desk/` stays the single source.
- `frontend/src/lib/site.js` `openApp()` opens the Pages desk in a new tab. Set
  `REACT_APP_DESK_PATH=/desk/index.html` to use the copy bundled into this site
  instead, or any other URL.
- The desk detects how it is served: from its own Python server (default port
  8000) it routes through that server's proxy and gets the full two-stage
  volatility model; on any static host it talks straight to Alpaca/Gemini and uses
  the browser stage-1 engine instead. See `desk/README.md`.
- `.github/workflows/pages.yml` publishes `desk/` to GitHub Pages.

## Running locally

**Website** (port 3000):

```bash
cd frontend
yarn install
yarn start
```

**Desk, standalone** — this is all it takes, and the hosted version needs none of it:

```bash
cd desk
python3 server.py            # http://localhost:8000  (full LSTM model)
```

You can also just open `desk/index.html` through any static server; it runs
without Python and uses the browser volatility engine.

**Backend API** (contact/feedback forms):

```bash
cd backend
python -m pytest             # tests
uvicorn server:app --reload  # run
```

See `backend/.env` for `MONGO_URL`, `DB_NAME` and related settings. The backend
tests expect the Emergent container layout (`/app/frontend/.env`) and do not run
outside it.

## Verifying the volatility port

The browser engine is checked against the Python model on identical bars:

```bash
node desk/tests/volmodel_parity.js
```

## Notes

- `.env` files and `desk/local-config.js` hold secrets and are git-ignored.
- Market data is licensed for personal, non-commercial use — see
  `desk/DISCLAIMER.md`. Do not deploy the desk in a way that redistributes it.
- `memory/PRD.md` tracks product decisions for the landing page.
