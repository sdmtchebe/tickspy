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

- 2026-10 (session 9):
  - **New `postmortem/` — trading post-mortem analytics engine.** A self-contained
    static module (no build step) that statistically analyses a trader's own past
    trades: CSV/JSON import with broker column mapping and validation, P&L/R/
    holding/expectancy/drawdown, adaptive-resolution MFE/MAE, benchmark-relative
    attribution, entry volatility/RVOL and deterministic market regimes.
  - **Reporting horizons** (day/week/month/quarter/year/rolling) auto-select the
    coarsest readable view, mark thin buckets `insufficient`, and show deltas
    against the previous bucket; **intratrade resolution** is derived per trade
    (1-min / 5-min / daily) and overlapping windows are merged, so only the bars a
    file needs are fetched.
  - **Anti-false-discovery pipeline**: hypothesis registry + Benjamini-Hochberg
    FDR, per-analysis sample gates, temporal stability across chronological
    windows, confounding detection via stratified comparison, chronological 70/30
    hold-out and walk-forward, robust statistics (Mann-Whitney, bootstrap,
    permutation), outlier-aware reporting, and a confidence ladder. Findings are
    typed (strength/weakness/opportunity/risk/neutral/insufficient) and each
    carries a "why did the system say this?" evidence block.
  - **Optional AI commentary** via the Worker's new `POST /api/postmortem`: Gemini
    narrates only; the module's grounding check discards any output that invents a
    number or gives advice, and a deterministic template is the fallback. A market
    backdrop (index return, idiosyncratic decomposition) lets a loss in a
    market-wide selloff be read as the world, not the trader.
  - Four synthetic datasets (tiny / realistic / adversarial / confounded) plus a
    synthetic market; 8 dependency-free node suites (135+ checks) including a
    headless DOM run of the real controller. Published to Pages at `/postmortem/`
    by `frontend/scripts/sync-postmortem.js`.
  - Worker: `POST /api/postmortem` added with strictly bounded input (20 KB body
    cap, 140-char strings, 30-item arrays, 4 levels deep, 6,000-char prompt),
    POST-only, uncached, never echoing upstream bodies. Worker suite now 39 tests.

- 2026-10 (session 10):
  - **The desk no longer requires an Alpaca account.** With no saved keys it used
    to bounce every visitor to Settings on load; that wall is gone. The default
    experience is now the **previous completed session, replayed**, fetched
    server-side from a free, keyless, publicly published end-of-day source and
    served by the Worker. Alpaca keys become an optional upgrade to live data.
  - New `GET /api/bars` in the Worker (`worker/src/bars.js`): ticker-validated,
    multi-symbol aware, cached per symbol and timeframe, and refreshed by a
    **daily Cron Trigger** (`17 5 * * *`, after the US close) so upstream requests
    follow the clock rather than the audience. Only the configured
    `DESK_SYMBOLS` are written to KV; an arbitrary ticker is served from the
    per-isolate memory cache, so a script cannot fill the namespace or burn the
    write quota. Hourly bars are refused (a session holds too few to be usable).
  - **The upstream clock is detected, not assumed.** The free source stamps its
    CSV in CET/CEST while the desk is written entirely against US/Eastern.
    `detectZone()` scores candidate zones against the one thing certain about a
    US session (09:30–16:00 ET) and picks the interpretation that puts the bars
    inside it; `STOOQ_ZONE` overrides. The endpoint returns the **last three
    complete sessions** — one is not enough, because the desk's indicators need
    40+ bars, a 15-minute session is only 26, and prior-day levels need the day
    before the one being replayed.
  - **The replay is a clock, not a fabrication.** `desk/freesrc.js` maps the wall
    clock onto the same time of day in the previous session, so at 11:00 ET you
    are looking at yesterday's 11:00 and the chart, VWAP, opening range and
    volume profile build the way they did that day; outside the session the whole
    of it is on screen. Every surface that shows it carries one shared
    disclosure sentence, and the timeframe selector offers only what the source
    can honestly supply (5 min, 15 min, 1 day). Nothing in the revealed prefix is
    ever from the future.
  - Adapted to free mode: watchlist quotes, timeframe alignment, relative
    strength, the volatility model (trained on the daily series), the news tab
    (aggregated market headlines filtered by ticker and company name instead of
    the per-symbol feed) and the scanner (watchlist movers). The setup wizard now
    only auto-opens when there is genuinely no source at all.
  - Tests: `worker/tests/run.js` **60 checks** (was 39), `desk/tests/freesrc.js`
    **54 checks**, and a new `desk/tests/edge_integration.js` (**25 checks**) that
    runs the real Worker handler against stubbed CSVs and feeds its JSON through
    the real free-mode engine — asserting the revealed prefix is long enough for
    the indicators, never contains a future bar, and spans more than one session.

- 2026-10 (session 11) — the last touches before the first real deployment:
  - **The trade journal is gone.** It logged fills to a browser-local list and
    computed a win rate and expectancy; nothing else read it, it was the one
    feature the desk carried that no visitor had asked for, and it had grown a
    privacy-policy row of its own. Removed from the Tools tab, from the boot
    path and from `PRIVACY.md`.
  - **Alerts are honest about their limits, and reliable while the page is
    open.** They were always in-page only, so the copy now says exactly that:
    they fire while the desk is open (including with the tab in the background)
    and they stop when the browser closes. The optional tone now plays through a
    single shared `AudioContext` that is created and resumed on the first user
    gesture, because a context created at alert time is suspended by autoplay
    policy — which is why the sound had been intermittent. Alerts also got their
    own 5-second check timer instead of depending on the chart's redraw cadence,
    and a `visibilitychange` handler re-checks them (and the calendar) the moment
    a backgrounded tab becomes visible again.
  - **The economic calendar keeps itself current.** It used to load only when the
    Calendar tab was opened, and its browser cache had no idea whether the date
    had changed. It now loads on boot, is treated as stale when the US/Eastern
    date rolls over, and reloads on tab focus — on top of the worker's hourly
    refresh and the Pages workflow's six-hourly one. The Alerts tab therefore has
    upcoming events to work with even if the Calendar tab was never opened.
  - **One AI key, on the server, and none in the browser.** The desk's Gemini
    key field, model picker, model loader, daily request cap, request counter and
    the whole `gem()` call path were deleted, along with the two "Factual
    summary" buttons (per-symbol news, calendar) that existed only to consume that
    key and would otherwise have been dead. The desk's only machine-generated
    text is now the single shared market overview the Worker writes on its cron
    and every visitor reads from cache, so per-visitor traffic can no longer
    multiply load on one key, and there is no way for a visitor to bring their
    own key at all.
  - **The Volatility tab no longer freezes the page.** Stage 2 trained the 2x64
    LSTM on the main thread, so opening the tab blocked the UI for the whole run.
    Training now happens in a Web Worker (`desk/volworker.js`) that pulls in
    `volmodel.js`, `volmodel2.js` and TensorFlow.js, streams its progress back as
    messages, and is terminated to cancel. If a worker cannot start, or
    TensorFlow.js cannot be downloaded, the tab falls back to training in the
    page and then to the stage-1 engine, exactly as before. The per-second clock
    tick was also made to update only the clock text instead of rebuilding the
    Session panel every second.
  - **A daily series no longer looks like one session per bar.** Stage 1 masks
    the bar-to-bar return at every US/Eastern session boundary, which is right
    for intraday bars (it removes the overnight jump) and wrong for a daily
    series, where every bar *is* a session — there the mask erased every return
    and left **zero usable sequences**, so free mode's LSTM and its backtest
    silently never ran. The rule is now read from the data: if most consecutive
    bars sit on different session dates, the series is not intraday. The intraday
    path is bit-identical (the Python parity harness still passes) and the daily
    path now yields 828 usable sequences where it had none.

## Backlog
- P0: Deploy the Worker (`cd worker && npx wrangler deploy`). It is
  load-bearing: the desk's no-key price data comes from `/api/bars` and its
  shared AI overview from `/api/overview`, so without it a visitor with no keys
  has no data source at all. The KV namespace id is already in `wrangler.toml`
  and `GEMINI_API_KEY` is the only secret it needs.
- P1: Set the support email (`SUPPORT_EMAIL` repo variable) to enable the contact
  and feedback forms, then confirm the address with FormSubmit.
- P2: Confirm the free price source still answers keylessly (its endpoint has
  been reported to gate behind a CAPTCHA and it has a low daily quota);
  `STOOQ_ZONE` is the escape hatch if the session clock ever looks shifted.
- P3: OG image asset; favicon refresh to the TickSPY mark.
- P4: True background alerts (firing with the browser closed) need Web Push: a
  service worker plus the Worker storing each subscription and evaluating it on
  a timer. Deliberately not built — the desk's alerts are in-page only and say
  so.
