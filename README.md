# TickSPY — marketing site + trading desk

One repository holding both halves of TickSPY:

```
frontend/   React 19 (CRA + craco) marketing landing page — the website
backend/    FastAPI contact/feedback API (MongoDB + email) — vestigial
worker/     Cloudflare Worker: the edge API (hidden Gemini key, aggregated news,
            calendar relay), globally cached
desk/       The trading helper: a self-contained dashboard (index.html) with an
            optional local Python server and an in-browser volatility engine
```

Published on GitHub Pages with nothing running locally:

- **https://sdmtchebe.github.io/tickspy/** — the landing page
- **https://sdmtchebe.github.io/tickspy/desk/** — the trading desk

**Open App** on the landing page opens the desk. `.github/workflows/pages.yml`
builds the site, bundles the desk into it and publishes the whole thing.

## How the two connect

- `frontend/scripts/sync-desk.js` copies `desk/index.html`, `desk/volmodel.js`,
  `desk/volmodel2.js` and `desk/edge-config.js` into `frontend/public/desk/`
  before `yarn start` and `yarn build`. `public/desk/` is generated and
  git-ignored, so `desk/` stays the single source. `edge-config.js` holds only a
  public Worker URL, so it is safe to publish (unlike `local-config.js`).
- `frontend/src/lib/site.js` `openApp()` opens `<base>/desk/index.html` in a new
  tab, where `<base>` is CRA's `PUBLIC_URL`, so it resolves at a domain root, a
  subpath such as `/tickspy/`, or in local dev. `REACT_APP_DESK_PATH` overrides it.
- The contact and feedback forms need **no server**: they post the message (and an
  optional screenshot) straight to a support inbox through
  [formsubmit.co](https://formsubmit.co), which answers CORS. Set the destination
  address once — repository variable `SUPPORT_EMAIL` for the Pages build, or
  `REACT_APP_SUPPORT_EMAIL`, or `window.DESK_SUPPORT_EMAIL` in
  `frontend/public/index.html`. Until one is set the forms say messaging is not
  configured rather than failing vaguely.
- The desk detects how it is served: from its own Python server (default port
  8000) it routes through that server's proxy and gets the Python two-stage
  volatility model; on any static host it talks straight to Alpaca/Gemini and runs
  both volatility stages in the browser, training the LSTM with TensorFlow.js. See
  `desk/README.md`.
- The landing page has a **setup guide** (`SetupGuide.jsx`, `#setup`) that walks
  a first-time visitor through getting free Alpaca keys, one click at a time, with
  an animated mock of each screen and a "why" under every step. It is linked from
  the nav and from the desk's Settings tab.
- `worker/` is an optional Cloudflare Worker that holds the Gemini key server-side
  and caches one shared market overview for every visitor, aggregates keyless news
  feeds that send no CORS headers, and relays the economic calendar. The desk
  talks to it only when `window.DESK_EDGE_API` is set in `desk/edge-config.js`,
  so the site keeps working without it. See `worker/README.md`.
- `.github/workflows/pages.yml` publishes `desk/` to GitHub Pages;
  `.github/workflows/deploy-worker.yml` type-checks and tests the Worker and
  deploys it once `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are set.

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
python3 server.py            # http://localhost:8000  (Python-side LSTM)
```

You can also just open `desk/index.html` through any static server; it runs
without Python and trains the LSTM in the browser.

**Backend API** — no longer needed. The contact and feedback forms go straight to
the support inbox through formsubmit.co, so there is nothing to run. `backend/` is
kept for reference:

```bash
cd backend
python -m pytest             # tests
uvicorn server:app --reload  # run
```

The backend tests expect the Emergent container layout (`/app/frontend/.env`) and
do not run outside it.

## Verifying the volatility port

Browser stage 1 is checked against the Python model on identical bars, and the
stage-1/stage-2 bridge is checked separately:

```bash
node desk/tests/volmodel_parity.js    # needs python3 with pandas/sklearn/torch/arch
node desk/tests/volmodel_stage2.js    # no extra dependencies
```

## Notes

- `.env` files and `desk/local-config.js` hold secrets and are git-ignored.
- Market data is licensed for personal, non-commercial use — see
  `desk/DISCLAIMER.md`. Do not deploy the desk in a way that redistributes it.
- `memory/PRD.md` tracks product decisions for the landing page.
