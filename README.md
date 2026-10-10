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

## Deploying to Netlify

### Drag-and-drop release (tickspy.com)

Run `npm run release:netlify` from `frontend/`. Upload the generated
`Desktop/TickSPY-Netlify-Release/` folder at <https://app.netlify.com/drop>.
Its `index.html` is at the top level; do not upload the repository source.
The folder includes the desk, English/French legal pages, `_redirects`, and
hash-based `_headers`. Advertising is disabled in this launch build.

`tickspy.com`, `www.tickspy.com`, and Netlify subdomains use a same-origin
`/edge/api/*` proxy to the existing Cloudflare Worker. Alpaca requests go
directly to Alpaca; credentials never use the proxy. The proxy avoids the
Worker's browser CORS restriction without requiring a separate Worker deploy.

Manual deployment does not configure DNS or activate FormSubmit. Set the primary
domain and HTTPS in Netlify, then activate the confirmation email sent to
`tickspysupport@gmail.com` on the first real form submission. Verify delivery.

Validation: `node scripts/security-check.cjs` and
`node scripts/launch-check.cjs` from `frontend/`. The latter needs
`playwright-core` and Chrome; `PLAYWRIGHT_MODULE` can point to an existing install.
It emulates Netlify's headers/proxy in Chrome; forms and Alpaca use fixtures,
while the free price/news/calendar/overview endpoints use the live Worker.

Technical validation is separate from public-display permissions for market
data/news and Québec privacy/language requirements. See the launch report.

### Repository-connected deployment

The repo is ready to drop into Netlify as-is. `netlify.toml` at the root sets the
base to `frontend`, the build command to `npm run build`, and the publish
directory to `build` — the build's `prebuild` hook copies `desk/` into the site,
so the desk is published at `/desk/` with the landing page.

1. **Import the repo.** In Netlify, *Add new site → Import an existing project*
   and pick `sdmtchebe/tickspy`. Leave the build settings alone; `netlify.toml`
   supplies them.
2. **Use Node 20.** Already pinned in `netlify.toml` (`NODE_VERSION = "20"`).
   `NPM_FLAGS = "--legacy-peer-deps"` covers the peer-dependency mismatch the
   CRA/craco toolchain ships with.
3. **Add the Worker's origin.** The keyless price, news, calendar and overview
   data come from the Cloudflare Worker in `worker/`. It only grants CORS to
   origins it knows, so either:
   - add your Netlify domain to `ALLOWED_ORIGINS` in `worker/wrangler.toml`
     before deploying the Worker (or set it as a Worker variable in the
     Cloudflare dashboard), or
   - rely on the built-in `*.netlify.app` / `*.netlify.com` patterns, which
     already cover the default Netlify subdomain.

   A custom domain is not covered by those patterns, so add it explicitly. If
   CORS is wrong, the site still loads but every free-tier panel says it cannot
   reach the data.
4. **(Optional) Turn the contact forms on.** They post through formsubmit.co,
   which needs a destination address. Set `REACT_APP_SUPPORT_EMAIL` in
   *Site settings → Environment variables* (or `window.DESK_SUPPORT_EMAIL` in
   `frontend/public/index.html`). Until one is set the forms say messaging is
   not configured instead of failing.
5. **Deploy.** Netlify runs `npm run build` in `frontend/` and publishes
   `frontend/build/`. `local-config.js` is deliberately never published; the CI
   workflow and `scripts/sync-desk.js` both strip it.

Set `SUPPORT_EMAIL` (a repository variable) the same way for the GitHub Pages
build if you want the forms live there too.

## How the two connect

- `frontend/scripts/sync-desk.js` copies `desk/index.html`, `desk/volmodel.js`,
  `desk/volmodel2.js`, `desk/volworker.js`, `desk/freesrc.js` and
  `desk/edge-config.js` into `frontend/public/desk/` before `npm start` and
  `npm run build` (via the `prestart`/`prebuild` hooks). `public/desk/` is
  generated and git-ignored, so `desk/` stays the
  single source. `edge-config.js` holds only a public Worker URL, so it is safe
  to publish (unlike `local-config.js`).
- Native links using `frontend/src/lib/site.js` `DESK_PATH` open `<base>/desk/index.html` in a new
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
  volatility model; on any static host it runs both volatility stages in the
  browser, with the LSTM trained in a Web Worker so the page stays responsive. It
  never calls an AI provider from the browser — the shared market overview is
  written server-side by `worker/` and read from cache. See `desk/README.md`.
- The landing page has a **setup guide** (`SetupGuide.jsx`, `#setup`) that walks
  a first-time visitor through getting free Alpaca keys, one click at a time, with
  an animated mock of each screen and a "why" under every step. It is linked from
  the nav and from the desk's Settings tab.
- `worker/` is a Cloudflare Worker that holds the Gemini key server-side and
  caches one shared market overview for every visitor, aggregates keyless news
  feeds that send no CORS headers, relays the economic calendar, and serves the
  previous completed session's prices for visitors who have no keys of their own.
  The desk reaches it through `window.DESK_EDGE_API` in `desk/edge-config.js`;
  without that URL a visitor with no keys has no price source at all. See
  `worker/README.md`.
- `.github/workflows/pages.yml` publishes `desk/` to GitHub Pages;
  `.github/workflows/deploy-worker.yml` type-checks and tests the Worker and
  deploys it once `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are set.

## Running locally

**Website** (port 3000):

```bash
cd frontend
npm install
npm start
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

- `frontend/package.json` sets `"homepage": "."`, so the build emits **relative**
  asset paths. The same `frontend/build/` therefore renders identically at a
  domain root (Netlify), under a subpath (GitHub Pages `/tickspy/`), and when the
  folder is opened straight from disk — double-clicking `index.html` used to give
  an unstyled page, because absolute `/static/...` paths resolve against the
  filesystem root. Keep it relative; a `PUBLIC_URL` env var would override it.
- The desk opens fine from disk too, but its no-key prices come from the Worker,
  which only grants CORS to real web origins. Opened as a local `file://` page the
  desk renders correctly and reports that it cannot reach the data; serve it over
  http (or use the deployed URL) to see live numbers.
- `.env` files and `desk/local-config.js` hold secrets and are git-ignored.
- Market data is licensed for personal, non-commercial use — see
  `desk/DISCLAIMER.md`. Do not deploy the desk in a way that redistributes it.
- `memory/PRD.md` tracks product decisions for the landing page.
