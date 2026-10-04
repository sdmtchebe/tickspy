# Desk — the trading helper

A self-contained trading dashboard: live Alpaca data, 14 indicators, candlestick
and chart patterns, alerts, a risk calculator, a backtester, a trade journal, a
scanner, and a volatility forecast. Everything is a market-data view for your own
research. **It is not investment advice** — see [DISCLAIMER.md](DISCLAIMER.md).

Files:

| File | Purpose |
|---|---|
| `index.html` | The whole UI (single page, no build step) |
| `volmodel.js` | Browser stage 1: Garman-Klass -> HAR walk-forward -> GARCH(1,1) |
| `volmodel2.js` | Browser stage 2: the 2x64 LSTM, trained in the browser with TensorFlow.js |
| `server.py` | Optional local server: API proxy and the `/vol` endpoint |
| `volatility_predictor.py` | The reference two-stage model in Python (HAR + GARCH -> LSTM) |
| `tests/volmodel_parity.js` | Checks browser stage 1 against the Python stage 1 |
| `tests/volmodel_stage2.js` | Checks the stage-1/stage-2 bridge in `volmodel.js` (no TensorFlow.js needed) |

## Two ways to run

The page auto-detects which mode it is in (`DESK_API` in `index.html`).

**1. Static / hosted** — no Python, nothing running locally. Used on
[GitHub Pages](https://sdmtchebe.github.io/tickspy/) and when the desk is bundled
into the marketing site.

- Alpaca REST, the live WebSocket, and Gemini are called straight from the
  browser; Alpaca's API answers CORS, so no proxy is needed.
- The Volatility tab runs the **full two-stage model entirely in the browser**.
  Stage 1 is Garman-Klass realized volatility -> HAR(1,5,22) expanding
  walk-forward -> GARCH(1,1) cross-check. Stage 2 is the 2x64 LSTM, trained from
  scratch in the page with TensorFlow.js (loaded lazily) and shown with a
  progress percentage and a time-left estimate. It can be cancelled. There are
  no pre-trained weights to ship and nothing to install.
- If TensorFlow.js cannot load, the tab falls back to the stage-1 engine and
  says so rather than failing.
- The economic calendar is baked into the site by the Pages workflow, because
  its upstream host sends no CORS headers.

**2. Local server** — the same two stages, but computed in Python.

```bash
python3 server.py            # http://localhost:8000
```

Serving the page from `server.py` is what selects this mode (port 8000 by
default). You then get the `/p` proxy and the Python `/vol` model, which is
faster on a long history and lets the result be cached. Set
`window.DESK_API_BASE` in `local-config.js` to force it elsewhere: `''` for a
same-origin server, or a full URL.

## Live news and the economic calendar

- **News is streamed, not polled.** The feed subscribes to Alpaca's dedicated news
  websocket (`wss://stream.data.alpaca.markets/v1beta1/news`) and shows a headline
  the moment it is published, tagged `NEW`. The REST endpoint is only used to
  backfill the list on load — on its own it lags, which is why the feed used to
  look stale. Ages are shown relative ("4m ago") and update as you read.
- **The calendar is served same-origin.** Its upstream host
  (`nfs.faireconomy.media`) sends no CORS headers, so a browser cannot call it
  from a static page. The Pages workflow fetches it on a six-hour schedule and
  ships it as `calendar.json`, both beside the desk and at the site root; when a
  local server is present, the existing proxy is used instead. The desk looks
  beside itself first and falls back one directory up, so it works from any mount
  point — reading it relative to the page alone is what made the tab report
  "Calendar unavailable: 404". Events are filtered to USD medium/high impact and
  grouped by day, with a countdown to the next release and forecast vs previous
  values.

## Keys and privacy

Enter your Alpaca keys (and optionally a Gemini key) in **Settings**. They are
stored in the browser's local storage only and sent only to the providers you
choose. `local-config.js` can hold local defaults and is git-ignored — never
commit it.

## Volatility engine parity

The browser stage 1 is checked against the Python stage 1 on identical bars, and
the stage-1/stage-2 bridge is checked on its own:

```bash
node tests/volmodel_parity.js          # needs python3 with pandas/sklearn/torch/arch
node tests/volmodel_stage2.js          # no extra dependencies
```

HAR, RMSE, the out-of-sample window and the neutral band reproduce the Python
model to machine precision. GARCH is an independently-converged MLE — arch's
SLSQP and its variance backcast cannot be ported exactly — so that one field is
compared with a documented tolerance. The Python-side numbers come from
`tests/volmodel_parity.py`.

Stage 2 is a fresh training run in the browser rather than a port of the Python
weights, so it is not bit-comparable to PyTorch. What *is* pinned is the
contract: `volmodel.js` splits into `buildStage1()` and `finish()`, stage 2
supplies only its out-of-sample output, and the backtest, chart series and
direction metrics are computed by the same code either way.

## Market data

Market data is provided by Alpaca/IEX under their terms and is for personal,
non-commercial use. Do not host this dashboard in a way that serves or
redistributes that data to others. `server.py` refuses to bind to a non-local
address unless `ALLOW_PUBLIC=1`.
