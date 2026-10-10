# TickSPY edge API

A small Cloudflare Worker that does the things a static site cannot:

| Endpoint | What it does |
|---|---|
| `GET /api/overview` | A Gemini-written market overview, cached globally |
| `GET /api/news` | Market headlines aggregated from six free feeds |
| `GET /api/calendar` | The economic calendar, relayed past its CORS block |
| `GET /api/bars` | The previous completed session's prices, with no API key |
| `GET /api/health` | Cache ages and per-source status |

Everything that touches an API key lives here. The browser gets our JSON and
nothing else.

## Why a server at all

Two hard browser limits force it:

1. **API keys.** A key in frontend code is a public key. Gemini is called with a
   Worker secret that never leaves the server.
2. **CORS.** CNBC, MarketWatch, Nasdaq and Investing.com send no CORS headers
   and the economic calendar refuses browser requests outright. A Worker can
   read them; a page cannot.

Adding the server does **not** mean running anything on your own machine. It
runs on Cloudflare's edge. The site stays static on GitHub Pages.

## How the caching works

The requirement is "10,000 visitors in 30 minutes = 1 Gemini call". Four
mechanisms, in order of how much they contribute:

1. **Cron Trigger every 20 minutes** (`wrangler.toml`) rebuilds the cache on a
   schedule. This is the one that matters: upstream calls follow the clock, not
   the audience. 72 calls a day whether you have 10 visitors or 10,000.
2. **Single-flight, per isolate.** While one build for a key is running, every
   other request awaits that same promise instead of starting its own. Without
   this, a burst of concurrent requests all find an empty cache — because the
   first response has not resolved yet — and all call Gemini at once.
3. **Per-isolate memory cache.** A warm isolate answers in microseconds without
   touching storage.
4. **Global KV cache.** A cold isolate in another region still finds the value,
   so it does not rebuild.

Plus **stale-while-revalidate**: an entry past its TTL is served immediately and
refreshed in the background, so a visitor never waits on Gemini and never sees an
error because of it.

Intervals: overview 25 min TTL / 20 min cron, news 3 min, calendar 1 h, price
bars 20 h.

## Price data, with no key (`/api/bars`)

This is what lets the desk work with no account. The desk used to be unusable
until a visitor created an Alpaca account — the first thing `load()` did was
bounce them to Settings. The request was the opposite: open the desk and see the
previous session straight away, for free.

Three constraints shaped it:

1. **No free price source sends CORS headers**, so a static page cannot call one.
   The fetch happens here instead, exactly like the news feeds and the calendar.
2. **It has to be legal.** Putting one account's market data behind a shared key
   would serve it to every visitor, which is redistribution — the thing
   `desk/DISCLAIMER.md` §6 and `desk/server.py` refuse to do. So the source is
   keyless and public: **Yahoo Finance**, with **Stooq** kept as a fallback. Note
   that Yahoo's chart endpoint is a public endpoint rather than a licensed data
   feed, so it is not a licence to publish the data either — the redistribution
   caveats in `desk/DISCLAIMER.md` §6 apply unchanged to how this is hosted.
3. **It has to be useful.** The desk is an intraday tool, and daily bars alone
   would gut it, so the previous session is served as 5-minute bars (rolled up to
   15 minutes on request) alongside the daily series.

```
GET /api/bars?symbol=SPY&tf=5Min      -> the session, plus the daily series
GET /api/bars?symbol=SPY&tf=1Day      -> daily bars only
GET /api/bars?symbols=SPY,QQQ&tf=1Day -> one entry per symbol, failures reported
```

Every response carries `source` — `yahoo`, `stooq`, or `mixed` for a symbol list
— so a caller can tell which upstream actually answered. The desk names it in the
on-screen disclosure.

**Updates daily, on the clock.** A second Cron Trigger (`17 5 * * *`, after the
US close) warms the `DESK_SYMBOLS` list for both timeframes, and the 20 h TTL
means a visitor is always reading an entry the cron wrote. Upstream requests
follow the clock, not the audience — the whole point of the caching here.

**Yahoo Finance is the primary source; Stooq is the fallback.** This is a
measurement, not a preference. Stooq refuses Cloudflare's network: a fetch from a
Worker either times out (HTTP 522, after roughly 40 s) or is answered with an
anti-bot HTML page, and the KV namespace confirmed it had never stored a single
bar. `query1.finance.yahoo.com/v8/finance/chart/` answers a Worker in under
200 ms from any colo, so it does the work and the CSV path is kept only for the
day Yahoo rate-limits or changes shape. Its attempt is capped by a short timeout,
because a fallback that hangs is worse than no fallback.

**On the Yahoo path, no clock has to be detected.** Every timestamp is an exact
UTC instant and `meta.exchangeTimezoneName` states the zone outright: daily bars
are re-stamped at that session's 09:30 ET — the convention the desk already reads
— and intraday bars keep their own instants. The CSV path still needs
`detectZone()`, because Stooq writes CET/CEST while the desk is written entirely
against US/Eastern: the plausible zones are scored against the one thing that is
certain about a US session (it occupies 09:30–16:00 ET) and the interpretation
that puts the bars inside it wins — a Warsaw file read as New York covers 0% of
the session, and vice versa. Set the `STOOQ_ZONE` var to override it on that
path.

**The free plan allows 10 ms of CPU per request, and that fixed the ranges.**
Measured, not guessed: a five-year daily series is a ~340 KB document, and
`/api/bars?symbols=` parses one of those per symbol, so five symbols blew the
budget and returned Cloudflare error 1102. The symbol-list path therefore asks
for a light `3mo` daily range — enough for a quote, the 21-EMA alignment and the
relative-strength window — and the single-symbol daily range is `2y`, about 500
bars, comfortably past the ~120 the volatility model needs.

The response returns the **last three complete sessions**. One was not enough:
the desk's indicators need 40+ bars, a 15-minute session is only 26, and
prior-day levels need the day before the one being replayed.

**Abuse is bounded rather than trusted.** The ticker is validated before it can
reach a URL, the symbol list is capped at 12, hourly bars are refused (a session
holds too few to be a usable view), and **only `DESK_SYMBOLS` are written to
KV** — an arbitrary ticker is served from the per-isolate memory cache, so a
script cannot fill the namespace or burn its write quota. As elsewhere, upstream
error bodies are never echoed: a failure becomes a short sentence such as
`Yahoo responded 500.` or `No data for that symbol.`, never the body itself.

`tests/run.js` proves the important ones: 10,000 concurrent requests make exactly
one upstream call, a warm cache makes none, and 200 further visits make none.

## Setup

### 1. Create the KV namespace

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create CACHE
```

Paste the printed `id` into the `[[kv_namespaces]]` block in `wrangler.toml`.
This repo already ships with an `id` for the live deployment; replace it with
yours if you are standing up a separate Worker.

### 2. Store the Gemini key as a secret

Get a key from <https://aistudio.google.com/apikey>, then:

```bash
npx wrangler secret put GEMINI_API_KEY
```

It is prompted for, encrypted at rest, and never written to any file in this
repo. `wrangler.toml` deliberately contains no key.

### 3. Point the site at the Worker

Deploy, note the URL, and put it in `desk/edge-config.js`:

```bash
npx wrangler deploy
```

```js
// desk/edge-config.js
window.DESK_EDGE_API = "https://tickspy-api.<your-subdomain>.workers.dev";
```

That file is copied into the published site by `frontend/scripts/sync-desk.js`,
so the desk picks it up on the next Pages build. No secret is involved — it holds
only a public URL. Until it is set the desk falls back to its old behaviour.

### 4. Deploy from GitHub instead (optional)

`.github/workflows/deploy-worker.yml` deploys on every push to `worker/`. It
needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

### Local development

```bash
cp .env.example .env      # fill in GEMINI_API_KEY
npx wrangler dev          # http://localhost:8787
npm test                  # 65 tests, no network needed
```

## Frontend usage

The browser only ever calls our endpoint:

```js
// Fetch the pre-generated overview. No API key, no Gemini from the browser.
async function loadOverview() {
  const res = await fetch(`${EDGE_API}/api/overview`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 503) return { unavailable: "The AI overview is not configured." };
  if (!res.ok) throw new Error(`Overview failed: ${res.status}`);
  const data = await res.json();
  // data.text      -> the summary
  // data.headlines -> the sources it was written from
  // data.cache     -> { hit, stale, ageSeconds }
  return data;
}
```

Without that URL the desk has no keyless price source at all, so a visitor with
no keys has nothing to show: the desk says so and offers the optional Alpaca
upgrade instead. Deploy the Worker before publishing the desk.

## Security notes

- The key is read from `env.GEMINI_API_KEY` inside the handler and used only in
  the `x-goog-api-key` header. It is never logged and never serialised.
- `/api/overview` takes **no user input**. The prompt is assembled entirely from
  our own cached headlines and calendar, so there is no prompt-injection path
  and no way for a visitor to use this as a free Gemini proxy.
- It is also the **only** AI text the desk ever shows. The desk has no key field
  and no way to supply one, so there is nothing for a visitor to bring their own
  key to. Because the entry is rebuilt by the Cron Trigger rather than per
  request, the project's key can only be spent on the schedule — one call per
  refresh window, no matter how many people are reading.
- The API is **read-only**, and no endpoint anywhere accepts caller-supplied
  text. Every route is a GET, anything else is a 405, and the only strings that
  reach a prompt come from our own cached feeds and calendar.
- Upstream error bodies are never echoed: a Gemini failure returns
  `Gemini responded 429`, not the body, which could contain key-tied details.
- The per-isolate memory cache is capped (`cache.js`, `MEMORY_LIMIT`), because
  price keys include the ticker: without a cap, a caller enumerating symbols
  could grow the map until the isolate ran out of memory. Only the configured
  `DESK_SYMBOLS` are ever written to KV, so the same script cannot burn the
  namespace's write quota either.
- The **price** endpoint is the one place anonymous load reaches a third party.
  Distinct `(timeframe, symbol)` pairs each cost one to two upstream requests, so
  a crawl could otherwise spend the free source's goodwill and degrade free mode
  for everyone. It costs the owner nothing — availability, not disclosure — and
  it is bounded rather than trusted: a per-isolate token bucket admits 60
  uncached upstream fetches a minute (`BARS_FETCH_BUDGET` in `src/index.js`) and
  answers `Too many price requests right now` beyond that. Cached and stale
  entries are never affected, so ordinary traffic cannot see it, and only
  `DESK_SYMBOLS` reach durable storage.
- Responses carry `Vary: Origin` and only grant CORS to origins listed in
  `ALLOWED_ORIGINS`.
- `/api/health` reports booleans (`configured.geminiKey: true`), never values.
  A test asserts the secret cannot appear in any response.

## Data sources

News comes from six public RSS feeds, chosen by measuring freshness rather than
by reputation. At the time of writing: MarketWatch ~29 min, CNBC ~31 min,
Investing.com ~32 min, Seeking Alpha ~92 min, Nasdaq ~95 min. Alternatives that
looked good but were dropped as stale or dead: Yahoo Finance's index feed (~10
days — its news feed, not the chart endpoint the price data uses), WSJ Markets
and MarketWatch Market Pulse (frozen documents), Barron's
(403) and CNBC Economy (404).

Each source's health is reported in `/api/news`, so a feed going quiet is
visible instead of silently shrinking coverage.
