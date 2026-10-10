# Desk — the trading helper

A self-contained trading dashboard: 14 indicators, candlestick and chart
patterns, alerts, a risk calculator, a backtester, a scanner, and a volatility
forecast. It works with **no account at all** (a free previous session, replayed)
and upgrades to live Alpaca data if you connect your own keys.
Everything is a market-data view for your own research. **It is not investment
advice** — see [DISCLAIMER.md](DISCLAIMER.md).

## No keys? It still works

Nothing has to be created before the desk is useful. With no saved keys the page
shows the **previous completed session, replayed**: while the US regular session
is open it walks through the same time of day in the previous session, so the
chart, VWAP, opening range, timeframe alignment and volume profile fill in the
way that day did. Outside the session the whole of it is on screen.

The data comes from `freesrc.js` plus the edge API's `GET /api/bars` (see
`../worker/`), which fetches a keyless, publicly available end-of-day price
series server-side (Yahoo Finance, with Stooq as a fallback) and caches it for a
day. It is one session old, delayed and
end-of-day, and every surface that shows it says so — it is a replay, never a
current quote. The timeframe selector therefore offers only what that source can
honestly supply: 5 minutes, 15 minutes and 1 day.

Alpaca keys are an **optional upgrade**: current prices, 1-minute bars, the live
trade stream and the symbol's own news feed. Nothing in the desk requires them.
The setup wizard only opens by itself when there is no data source at all,
because in free mode there is nothing to fix.

Files:

| File | Purpose |
|---|---|
| `index.html` | The whole UI (single page, no build step) |
| `volmodel.js` | Browser stage 1: Garman-Klass -> HAR walk-forward -> GARCH(1,1) |
| `volmodel2.js` | Browser stage 2: the 2x64 LSTM, trained with TensorFlow.js |
| `volworker.js` | Runs the two-stage volatility model in a Web Worker so training never blocks the page |
| `freesrc.js` | The no-key mode: the replay clock, the session reveal, derived quotes and symbol-news matching |
| `edge-config.js` | Where the optional Cloudflare edge API lives (`window.DESK_EDGE_API`); public, no secret |
| `server.py` | Optional local server: API proxy and the `/vol` endpoint |
| `volatility_predictor.py` | The reference two-stage model in Python (HAR + GARCH -> LSTM) |
| `tests/volmodel_parity.js` | Checks browser stage 1 against the Python stage 1 |
| `tests/volmodel_stage2.js` | Checks the stage-1/stage-2 bridge in `volmodel.js` (no TensorFlow.js needed) |
| `tests/freesrc.js` | Checks the replay clock, the reveal and the derived data in `freesrc.js` |
| `tests/edge_integration.js` | The seam: the real Worker handler's `/api/bars` JSON through `freesrc.js` |
| `tests/volworker.js` | The worker's message contract: progress, result, errors, eager models and lazy TensorFlow.js |

## Two ways to run

The page auto-detects which mode it is in (`DESK_API` in `index.html`).

**1. Static / hosted** — no Python, nothing running locally. Used on
[GitHub Pages](https://sdmtchebe.github.io/tickspy/) and when the desk is bundled
into the marketing site.

- Alpaca REST and the live WebSocket are called straight from the browser;
  Alpaca's API answers CORS, so no proxy is needed. The AI market overview is
  never called from the browser at all — it is written once by the edge API and
  read from its cache.
- The Volatility tab runs the **full two-stage model entirely in the browser**,
  but off the main thread. Stage 1 is Garman-Klass realized volatility ->
  HAR(1,5,22) expanding walk-forward -> GARCH(1,1) cross-check. Stage 2 is the
  2x64 LSTM, trained from scratch with TensorFlow.js (loaded lazily). Both run
  inside a Web Worker (`volworker.js`), so a training run no longer freezes or
  drags on the page: the percentage and time-left come from worker messages and
  Cancel terminates the worker. There are no pre-trained weights to ship and
  nothing to install.
- If the browser cannot start a worker the model is trained in the page instead,
  and if TensorFlow.js cannot load the tab falls back to the stage-1 engine and
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
- **Market news and the shared overview come from the edge API** when
  `window.DESK_EDGE_API` is set in `edge-config.js`. A small Cloudflare Worker
  (see `../worker/`) aggregates keyless feeds that send no CORS headers, and
  writes one Gemini overview every 20 minutes that every visitor shares, so the
  Gemini key never reaches the browser and 10,000 visitors cost one API call.
  Without that URL the News tab still shows the per-symbol Alpaca feed, and the
  calendar falls back to the baked file below.
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
- **It keeps itself current.** The Worker refreshes the calendar hourly and the
  Pages workflow every six hours, and the desk no longer waits for you to open
  the tab: it loads the calendar on start, reloads it when the US/Eastern date
  changes (so a page left open overnight picks up the new week), and reloads it
  when the tab becomes visible again after its cached copy has gone stale.

## Alerts

Alerts are checked in the page: a price alert on the current symbol, and
scheduled economic-calendar warnings a chosen number of minutes before a release
and optionally on the release itself. They fire while the desk is open, including
when the tab is in the background, and play a short tone unless you turn the sound
off. They **do not** fire once the tab or the browser is closed — nothing is sent
to a server to watch for you — and the Alerts tab says so.

## Keys and privacy

**Alpaca keys are optional.** Enter them in **Settings** to upgrade to live
data. They are stored in the browser's local storage only and sent only to
Alpaca. There is no AI key to enter anywhere: the shared market overview is
generated by the edge API with the project's own key and cached, so the desk
never holds a key and a visitor cannot spend one. `local-config.js` can hold local
defaults and is git-ignored — never commit it.

There are three ways into the same guide, so it is hard to miss:

- a **setup wizard** inside the desk, opened from **Connect Alpaca for live
data** in Settings: five plain-English steps with a "Why" under each and the two
  key boxes in the last step. Saving or skipping is remembered. It only opens by
  itself when no data source exists at all;
- a collapsible
  **"How to get your free Alpaca keys"** summary in the Settings tab; and
- the illustrated site version at `/#setup`, with a mock of every screen.

## Free mode tests

```bash
node tests/freesrc.js            # replay clock, reveal, derived quotes, symbol news
node tests/edge_integration.js   # the real Worker handler -> the real free-mode engine
node tests/volworker.js          # the volatility worker's message contract, stubbed engine
```

The integration test exists because each half can be right while the join is
wrong: it runs `../worker/src/index.js` against stubbed upstream payloads and asserts
that the replay's revealed prefix is long enough for the indicator panels, never
includes a bar from the future, and spans more than one session (which is what
prior-day levels need). No browser, no network.

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

`tests/volmodel_stage2.js` also pins the **bar cadence**. Stage 1 masks the
bar-to-bar return at every US/Eastern session boundary: right for intraday bars,
where the overnight jump is not a return the model should learn from, and wrong
for a daily series, where every bar *is* a session and masking deletes the whole
sample. Free mode feeds the model daily bars, so the rule now reads the cadence
from the data itself; the intraday path is unchanged, which is why the parity
harness above still passes.

## Market data

With no keys, market data is the keyless end-of-day series served by the edge
API, fetched from **Yahoo Finance** (with **Stooq** as a fallback); it is the
most recent completed session, one session old and replayed. With your own keys
it is **Alpaca/IEX** under their terms. Either
way it is for personal, non-commercial use. Do not host this dashboard in a way
that serves or redistributes that data to others. `server.py` refuses to bind to
a non-local address unless `ALLOW_PUBLIC=1`.
