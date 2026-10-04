# TickSPY — Free Day Trading Desk Landing Page

## Original problem statement
A dark, cinematic landing page (originally "SPYtick", rebranded to **TickSPY** on 2026-07) showcasing free trading analysis tools through animated mock UIs, a starry sky with shooting stars and floating candlestick constellations, and Apple-grade glassmorphism. Award-level polish with framer-motion reveals and Lenis momentum scrolling.

## Personas
- Retail day traders tired of paying for charting tools.
- Curious beginners who want plain-English explanations next to every number.

## Core requirements
- Design: `#06080F` background, mint `#00E5A0` accent, glass cards (backdrop-filter), Sora + DM Sans + JetBrains Mono.
- Brand: **TickSPY** — "Tick" in mint, "SPY" in white, large in nav/footer.
- Sections: sticky glass nav (+ scroll progress bar, mobile hamburger), hero (animated candle chart, mint "moves." accent, 4 stats: $0 / 14 live indicators / 2-stage volatility model / Any US ticker), ticker marquee, features grid (6), interactive demo tabs (Chart, News, Volatility Model, Alerts & Indicators), How It Works, Why TickSPY, Contact + Feedback forms, footer.
- No TradingView: charts are rendered by an in-house canvas engine (`CandleChart.jsx`). `lightweight-charts` removed.
- Volatility tab mirrors the real pipeline: Stage 1 (Garman-Klass RV → HAR(1,5,22) expanding walk-forward → GARCH(1,1) cross-check → residuals) and Stage 2 (2×64 LSTM, dropout 0.2, residual correction + 3 direction logits, RobustScaler lookback 30, auto-gated by OOS RMSE gain with STAGE2_FULL_IMPROVE = 5.0, capped ±50%, uncertainty band, session-boundary masking, data-quality checks).
- Alerts tab: price-alert composer (ticker, above/below, price → arms → fires into feed), alert feed with kind badges, live board of 14 indicators with "?" tooltips: EMA 9/21, VWAP, RSI 14, MACD hist, Bollinger %B, Relative volume, OBV (10), ATR 14, ADX 14 (DI±), Stochastic (14,3), CCI 20, Williams %R 14, MFI 14, Keltner/squeeze.
- Backend: `POST /api/contact`, `POST /api/feedback` → MongoDB + Emergent email notification.
- No auth. All market data is mock/demo.

## Architecture
```
backend/   server.py (FastAPI, Mongo via MONGO_URL/DB_NAME), emailer.py (Emergent email)
frontend/  src/App.js (Lenis + sections)
           src/lib/market.js (mock feed, VWAP/BB/ATR), indicators.js (14 indicators), volmodel.js (2-stage vol sim), site.js
           src/components/site/  Nav, Hero, HeroCard, CandleChart (canvas), Marquee, Features, FeatureArt,
                                 Demo, DemoChart, DemoNews, DemoVolatility, VolPipeline, DemoAlerts, IndicatorBoard,
                                 HowItWorks, Why, Contact, Footer, Sky (stars, aurora, constellations), motion (Reveal/SplitWords/Parallax), Logo, bits
```

## Implemented
- 2026-07 (session 1): full landing page, backend endpoints + email, tests (12/12 backend).
- 2026-07 (session 2):
  - Removed TradingView dependency; custom canvas candlestick engine with crosshair, VWAP, Bollinger fill, volume.
  - Rebrand to TickSPY (logo, copy, meta/OG/schema), larger mint logo.
  - Hero stats updated; mint "moves." in headline; hero parallax; scroll cue; scroll progress bar.
  - Volatility Model demo (two-stage pipeline chart + readout + animated pipeline diagram).
  - Alerts & Indicators demo (price alert composer, feed with kinds, 14-indicator live board w/ tooltips).
  - Scroll animations: word-split heading reveals, blur/rise reveals, staggered lists, animated timeline, 3D card entrance.
  - Background: 9 shooting stars (some mint), aurora blobs, horizon grid, 6 floating candlestick constellations with scroll parallax.
  - Glass upgrade: 22px blur, inner highlight, sheen gradient, hover glow following the cursor, `glass-inner` nested panels.
  - Mobile hamburger menu (AnimatePresence) verified at 390px.
- 2026-10 (session 3):
  - Merged the trading desk into the repo at `desk/` and bundled it into the site at `/desk/index.html` via `frontend/scripts/sync-desk.js`.
  - "Open App" (nav + hero) now opens the desk instead of a placeholder toast; `REACT_APP_DESK_PATH` overrides the target.
  - Desk page resolves its API base automatically (same-origin behind its own server, `http://localhost:8000` when served by the website); `desk/server.py` gained CORS/preflight support.
- 2026-10 (session 4):
  - Desk now runs with **no local server**: Alpaca/Gemini are called directly from the browser (Alpaca answers CORS). `DESK_API` selects server mode only when the page is served by the desk's own server (port 8000) or `window.DESK_API_BASE` is set.
  - Volatility tab ported to the browser as `desk/volmodel.js` (stage 1: Garman-Klass -> HAR(1,5,22) expanding walk-forward -> GARCH(1,1), plus the hold-out backtest, band, regime and reliability gating). Stage-2 LSTM and the local-model provider remain server-only and are reported as unavailable rather than faked.
  - `desk/tests/volmodel_parity.js` compares the port against the Python model on identical bars; HAR/RMSE/window/band match to machine precision, GARCH is documented as an approximate independent MLE.
  - `.github/workflows/pages.yml` publishes `desk/` to GitHub Pages at https://sdmtchebe.github.io/tickspy/.
- 2026-10 (session 5):
  - News is now **live**: the desk subscribes to Alpaca's news websocket (`v1beta1/news`) and prepends headlines as they are published, with a `NEW` tag, relative ages and a feed status line. REST is only used to backfill.
  - Economic calendar is served same-origin as `calendar.json`, fetched and refreshed by the Pages workflow on a six-hour schedule (the upstream sends no CORS headers). Display regrouped by day with day headers, a next-release countdown, impact badges, released/past dimming, and a "high impact only" filter.

- 2026-10 (session 6):
  - Stage 2 is now in the browser too. `desk/volmodel.js` was split into `buildStage1()` + `finish()`, and new `desk/volmodel2.js` trains the 2x64 LSTM with TensorFlow.js (loaded lazily from jsDelivr) on the stage-1 features, then hands its out-of-sample residual back to `finish()`. The Volatility tab shows a progress percentage and a time-left estimate, can be cancelled, and falls back to stage 1 if TensorFlow.js will not load. Measured in a real browser: ~50 s for 400 bars, model, gating and direction metrics all produced.
  - The local-model provider was removed entirely (Settings markup, `lmChat()`, the `gem()` branch and the `/lm` handler in `desk/server.py`); summaries are Gemini-only.
  - Contact and feedback forms no longer need a server. They POST to a configurable support inbox through `formsubmit.co` (`REACT_APP_SUPPORT_EMAIL`, repo variable `SUPPORT_EMAIL`, or `window.DESK_SUPPORT_EMAIL`). CORS preflight verified against the live endpoint. `axios` and the stale `REACT_APP_BACKEND_URL` were dropped from the bundle.
  - `desk/tests/volmodel_stage2.js` guards the stage-1/stage-2 bridge (29 checks, no extra dependencies).
  - Bug found by a real-browser test: `<select id="tf">` makes `window.tf` the dropdown, so the TensorFlow.js loader would never load the library. `loadTf()` now checks for the actual API (`tensor` + `sequential`).

- 2026-10 (session 7):
  - **Fixed: the economic calendar never loaded on the published site.** Moving the desk to `/desk/` in session 6's predecessor left the baked `calendar.json` at the site root while the desk fetched it relative to its own page, so every visit hit `/desk/calendar.json` → 404 and the tab reported "Calendar unavailable: 404". The desk now looks beside itself first and falls back one directory up, and the workflow ships a copy in both places (plus sanity-checks both), so the desk works from any mount point.
  - Added an explainer for University of Michigan Inflation Expectations, which no pattern matched.
  - Cleaned the now-dead `prov`/`lbase`/`lm` local-model fields out of the local `desk/local-config.js`.

- 2026-10 (session 8):
  - **New `worker/` (Cloudflare Worker edge API).** Delivers the requested "secure, server-side cached Gemini endpoint": the key lives only in the Worker secret `GEMINI_API_KEY` (never in the client or Git), and a 20-minute Cron Trigger plus single-flight and a KV cache guarantee one Gemini call per refresh window regardless of audience — a test proves 10,000 concurrent requests make exactly one upstream call and a warm cache makes none. Also aggregates six keyless news feeds (MarketWatch, CNBC, Investing.com, CNBC US, Nasdaq, Seeking Alpha) that send no CORS headers, and relays the economic calendar. Routes: `/api/overview`, `/api/news`, `/api/calendar`, `/api/health`; CORS restricted to `ALLOWED_ORIGINS`; upstream error bodies never echoed. 31 tests pass. `wrangler.toml`, `.env.example`, `.gitignore`, `README.md` and `.github/workflows/deploy-worker.yml` included.
  - **User-configurable calendar alerts** in the desk: toast plus optional tone, a lead time (1–120 min), high-only or high+medium, and an optional on-release notice. Preferences persist in `localStorage`; each event fires once, keyed by title and time, so ticks, re-renders and reloads cannot repeat it. 13 browser checks pass.
  - **Desk wired to the edge API**: new `desk/edge-config.js` (`window.DESK_EDGE_API`, added to `sync-desk.js`), a two-column News tab (market headlines + shared overview beside the per-symbol feed), and a calendar that prefers the hourly edge copy over the baked file. Verified end to end against a mock Worker in a real browser.
  - Added an extremely clear, illustrated **Alpaca key setup tutorial** on the landing page (`SetupGuide.jsx`, `#setup`, linked from the nav), matching the site's glass/motion design: five steps with an animated mock of each screen and a plain-English "why" under every one, three "why" cards, five FAQs, and CTAs. The desk's Settings tab gains a matching five-step collapsible guide.
  - Added a **first-run setup wizard inside the desk** so the same tutorial cannot be missed when someone opens the app directly: with no saved keys (and after the legal notice) a five-step walkthrough opens by itself, shows progress dots and a "Why" per step, and carries the two key boxes in its final step so a visitor can paste and connect without leaving it. Saving or skipping is remembered, and **Show me how, step by step** in Settings reopens it. 28 browser checks pass.

## Backlog
- P0: Set the support email (`SUPPORT_EMAIL` repo variable) to enable the contact and feedback forms, then confirm the address with FormSubmit.
- P1: Deploy the Worker (create the KV namespace, set `GEMINI_API_KEY`, set `window.DESK_EDGE_API`) so the shared Gemini overview and aggregated market news light up.
- P2: OG image asset; favicon refresh to TickSPY mark.
