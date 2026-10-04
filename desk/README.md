# Desk — the trading helper

A self-contained trading dashboard: live Alpaca data, 14 indicators, candlestick
and chart patterns, alerts, a risk calculator, a backtester, a trade journal, a
scanner, and a volatility forecast. Everything is a market-data view for your own
research. **It is not investment advice** — see [DISCLAIMER.md](DISCLAIMER.md).

Files:

| File | Purpose |
|---|---|
| `index.html` | The whole UI (single page, no build step) |
| `volmodel.js` | Browser stage-1 volatility engine, used when there is no server |
| `server.py` | Optional local server: API proxy, `/vol` model, `/lm` local models |
| `volatility_predictor.py` | The full two-stage model (HAR + GARCH -> LSTM) |
| `tests/volmodel_parity.js` | Checks the browser engine against the Python model |

## Two ways to run

The page auto-detects which mode it is in (`DESK_API` in `index.html`).

**1. Static / hosted** — no Python, nothing running locally. Used on
[GitHub Pages](https://sdmtchebe.github.io/tickspy/) and when the desk is bundled
into the marketing site.

- Alpaca REST, the live WebSocket, and Gemini are called straight from the
  browser; Alpaca's API answers CORS, so no proxy is needed.
- The Volatility tab uses the **in-browser stage-1 engine**: Garman-Klass
  realized volatility -> HAR(1,5,22) expanding walk-forward -> GARCH(1,1)
  cross-check, with the same hold-out backtest and reliability gating.
- The stage-2 LSTM and local-model provider are unavailable (both need Python),
  and the page says so instead of faking a value.
- The economic calendar comes from a host that sends no CORS headers, so it
  reports itself as unavailable in this mode.

**2. Local server** — full two-stage model.

```bash
python3 server.py            # http://localhost:8000
```

Serving the page from `server.py` is what selects this mode (port 8000 by
default). You then get the `/p` proxy, the PyTorch LSTM stage, and local model
support. Set `window.DESK_API_BASE` in `local-config.js` to force it elsewhere:
`''` for a same-origin server, or a full URL.

## Live news and the economic calendar

- **News is streamed, not polled.** The feed subscribes to Alpaca's dedicated news
  websocket (`wss://stream.data.alpaca.markets/v1beta1/news`) and shows a headline
  the moment it is published, tagged `NEW`. The REST endpoint is only used to
  backfill the list on load — on its own it lags, which is why the feed used to
  look stale. Ages are shown relative ("4m ago") and update as you read.
- **The calendar is served same-origin.** Its upstream host
  (`nfs.faireconomy.media`) sends no CORS headers, so a browser cannot call it
  from a static page. The Pages workflow fetches it on a six-hour schedule and
  ships it as `calendar.json`; when a local server is present, the existing proxy
  is used instead. Events are filtered to USD medium/high impact and grouped by
  day, with a countdown to the next release and forecast vs previous values.

## Keys and privacy

Enter your Alpaca keys (and optionally a Gemini key) in **Settings**. They are
stored in the browser's local storage only and sent only to the providers you
choose. `local-config.js` can hold local defaults and is git-ignored — never
commit it.

## Volatility engine parity

The browser port is checked against the Python model on identical bars:

```bash
node tests/volmodel_parity.js          # needs python3 with pandas/sklearn/torch/arch
```

HAR, RMSE, the out-of-sample window and the neutral band reproduce the Python
model to machine precision. GARCH is an independently-converged MLE — arch's
SLSQP and its variance backcast cannot be ported exactly — so that one field is
compared with a documented tolerance. The Python-side numbers come from
`tests/volmodel_parity.py`.

## Market data

Market data is provided by Alpaca/IEX under their terms and is for personal,
non-commercial use. Do not host this dashboard in a way that serves or
redistributes that data to others. `server.py` refuses to bind to a non-local
address unless `ALLOW_PUBLIC=1`.
