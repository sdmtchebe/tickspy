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

## Backlog
- P1: Optional screenshot upload on feedback form (object storage).
- P2: OG image asset; favicon refresh to TickSPY mark.
