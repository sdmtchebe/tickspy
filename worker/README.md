# TickSPY edge API

A small Cloudflare Worker that does the things a static site cannot:

| Endpoint | What it does |
|---|---|
| `GET /api/overview` | A Gemini-written market overview, cached globally |
| `GET /api/news` | Market headlines aggregated from six free feeds |
| `GET /api/calendar` | The economic calendar: the provider's rated week plus three weeks beyond it |
| `GET /api/bars` | The previous completed session's prices, with no API key |
| `GET /api/research/brief?symbol=SPY` | A computed daily brief and walk-forward range model for one symbol |
| `GET /api/research/market` | The same brief for the symbols configured in `DESK_SYMBOLS` (the shipped `wrangler.toml` warms SPY, QQQ, AAPL, NVDA and TSLA) |
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

## The calendar, and why it has two upstreams (`/api/calendar`)

`worker/src/calendar.js` is the only place that knows where calendar weeks come
from, and the Pages build runs the same module (`scripts/write-calendar.mjs`) so
the static site and this API can never disagree about which weeks exist.

| Upstream | Covers | Ratings |
|---|---|---|
| `nfs.faireconomy.media/ff_calendar_thisweek.json` | one week, exactly | yes: High / Medium / Low / Holiday |
| `api.nasdaq.com/api/calendar/economicevents?date=…` | any date asked for | no |

The provider file is the good one and the limited one: its `nextweek` and
`lastweek` siblings answer 404, so on its own the desk could never answer "what
is happening the week after this one". Nasdaq's per-day endpoint covers the gap
and is keyless; it rejects non-browser agents with a 403, so the request carries
a browser user agent — the endpoint is public and answers with
`access-control-allow-origin: *`, so it is meant to be called from a page.

Rules the merge follows:

- The Nasdaq window starts the day after the provider's last published day; a day
the provider already covers is never asked for twice.
- A stale or empty provider week moves the window up to today, so a failed
refresh still leaves the desk a week.
- Rows are deduplicated on timestamp plus title, and a rated row always wins, so a
release the provider rated is never downgraded to unrated.
- Nasdaq rows have no rating and are served with an empty `impact`. The desk labels
them "not rated" and they cannot fire impact-based alerts. A rating is never
invented.
- Nasdaq's clock column is GMT and is converted as such; rows with no clock time
("All Day", "Tentative") are dropped rather than placed at an arbitrary hour.
- One day failing is not a failure: the rest of the window is still served.

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

## Research (`/api/research/*`)

Two read-only endpoints that answer a narrower question than the AI overview:
what do the daily bars themselves say, and how wide has the next session's
range been in this volatility state?

```
GET /api/research/brief?symbol=SPY
GET /api/research/market
```

There is **no language model** in this path. The brief is assembled in
`src/research.js` from facts that are also returned in `evidence`, so every
number in a sentence can be checked against the same response. That removes the
hallucination surface entirely and makes the endpoint cheap enough to cache for
the same 20 hours as the bars.

### The range model

A one-dimensional k-nearest-neighbour regression over completed daily bars:

- score at close `t`: `0.65 * log(realized vol 20) + 0.35 * log(ATR14 / price)`
- target: `(high[t+1] - low[t+1]) / close[t]`
- prediction: the 5th/10th/25th/50th/75th/90th/95th percentiles of the 40
  nearest historical sessions

The neighbour set is restricted to `j < t`, so the session after `j` had
already closed by the prediction close. The backtest repeats the exact same
walk-forward procedure over the last 120 sessions and reports how often each
nominal band contained the actual range. Those coverage numbers are returned
and displayed; they are not assumed to be 80/50/90, and they change with the
symbol and the data. The page shows the measured figure and the sample size,
not a promise.

### What it deliberately does not claim

- No direction forecast, no price target, no buy/sell language.
- No earnings dates, revenue or valuation: those are not in this feed.
- No intraday or after-hours data: the brief uses completed daily bars.
- No attribution of market-wide headlines to one ticker.

### Caching and cost

A brief is cached under `research:v1:<SYMBOL>` for 20 hours with a four-day
stale grace, matching the daily bars. The daily cron rebuilds the brief for
every symbol in `DESK_SYMBOLS` from the bars it just refreshed, so the first
visitor after the cron reads a warm entry. Only those symbols get a durable KV
entry; an arbitrary ticker is computed in the per-isolate memory cache, the same
rule the bars path uses, so a script walking tickers cannot fill the namespace.
The market brief is always durable and reads the default list's cached bars, not
the visitor's browser-local watchlist.

The work is CPU-only and small and no secret or upstream key is involved. The
cron pays that computation once; later visitors read the cache. A symbol outside
`DESK_SYMBOLS` pays it on its first request in each isolate.

## No alert endpoint — alerts belong to the browser

There used to be a server-side alert channel here: `/api/alerts/*`, a bot
webhook, and a five-minute cron that re-checked every rule. It is gone. Delivery
now happens in the page that owns the rule — a system notification, a sound and
a badge, configured on the desk's Alerts tab — so nothing about an alert leaves
the visitor's machine.

That moves the honest limits into the desk, where they are stated in the same
words: an in-page alert fires only while the tab is open, a background tab is
throttled by the browser, and a system notification still depends on the
permission the browser granted. In exchange this API keeps no per-person state
at all: everything above is read-only and identical for every caller, and the
comment wall below is the only endpoint that stores what a visitor wrote.

## Comments (`/api/comments`)

The landing page has an anonymous comment wall. It is the only endpoint that
stores what a visitor wrote, so it is the one with the most deliberate limits.

- **Identity.** The browser generates a 32-byte random key and keeps it in
  `localStorage`. The Worker stores only
  `SHA-256("tickspy-comment-author-v1:" + key)`. There is no email, no IP column
  and no cookie. The nickname ("Quiet Otter #4821") is derived from that digest,
  so a browser keeps the same name without the server knowing who it is.
- **Delete.** `DELETE /api/comments/:id` runs
  `UPDATE … WHERE id = ? AND author_hash = ?`. The id is public; the key is not.
  The text is wiped in the same statement, so a delete is a delete rather than a
  hidden row.
- **Storage.** D1 (`COMMENTS_DB`), one table, schema in `migrations/`.
- **Abuse.** A 20-second gap, 8 an hour and 40 a day per identity, enforced by
  D1 so it holds across isolates; per-IP counters in memory; and a filter that
  holds slurs (whole words only, so "spices" is not one), more than two links,
  solicitation, shouting, repeated characters and injection-shaped markup for a
  person to look at.
- **Bots.** Cloudflare Turnstile, enabled by setting `TURNSTILE_SITE_KEY` (a var)
  and `TURNSTILE_SECRET_KEY` (a secret). When both exist, a post must carry a
  valid unused token or it is refused before any database work; the feed then
  advertises the site key, so the page renders the widget without a rebuild.
  Until then the gate is absent and the layers above are the whole defence.
- **Moderation.** `GET /api/comments/admin` and `POST /api/comments/admin/:id`
  with `Authorization: Bearer $COMMENTS_ADMIN_TOKEN`. `/moderation.html` is a
  private, unindexed page for the same API, and `scripts/comments.mjs` does it
  from a terminal.
- **Paging.** The feed and the queue page backwards on a `<created_at>_<id>`
  cursor. A bare timestamp still works, but the id is what stops two comments
  written in the same millisecond from hiding each other forever.

### Removing a comment (as the moderator)

Hiding is reversible; deleting wipes the text and cannot be undone. Three ways
to do the same thing, all needing `COMMENTS_ADMIN_TOKEN`:

1. **Browser** — open `/moderation.html`, paste the token, pick the filter
   (`Visible`, `Held`, `All`), press **Delete** and confirm. The row keeps its
   `id`, timestamp and author hash so the rate limiter still counts it, but
   `body` becomes empty and it disappears from the wall.
2. **Terminal** — `COMMENTS_ADMIN_TOKEN=… node scripts/comments.mjs delete <id>`.
   `list` prints the ids (`--status all` to find a hidden one).
3. **Directly in D1**, for a row the API cannot reach or to erase it entirely:

```bash
npx wrangler d1 execute tickspy-comments --remote \
  --command "UPDATE comments SET deleted=1, status='hidden', body='', deleted_at=strftime('%s','now')*1000 WHERE id='<id>'"

# Or remove the row, its rate-limit history and its duplicate hash outright:
npx wrangler d1 execute tickspy-comments --remote \
  --command "DELETE FROM comments WHERE id='<id>'"
```

Add `--local` instead of `--remote` when working against `wrangler dev`.
- **What is not defended.** With the bot gate off, a determined person can
  script many requests from many addresses; the limits slow that down rather
  than stop it. The identity is free to rotate, and the per-IP counters are per
  isolate, which is why Turnstile — not the rate limits — is the line that holds
  against a bot. And the text filter is a hold list, not a classifier: it errs
  toward hiding, and a person has to release a false positive.

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
repo. `wrangler.toml` deliberately contains no key.### 3. Point the site at the Worker

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

### 4. Turn on comments (D1 and a moderation secret)

The comment wall needs its own database and one secret:

```bash
cd worker
npx wrangler d1 create tickspy-comments
# paste the printed database_id into [[d1_databases]] in wrangler.toml
npx wrangler d1 migrations apply tickspy-comments --remote
npx wrangler secret put COMMENTS_ADMIN_TOKEN
```

Generate the token with `openssl rand -hex 32`, or any password manager's
long-random-string button. It is the only credential that can hide or delete
someone else's comment, so keep a copy somewhere you can reach it — if it is
lost, set a new one with the same command.

Optional, and the only layer that stops a *scripted* flood rather than slowing
it: the Turnstile bot gate. Create a widget in the Cloudflare dashboard
(Turnstile → Add site), list the hostnames the wall is posted from — including
any `*.netlify.app` preview you post from — then:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY   # the widget's secret key
# put the widget's site key in wrangler.toml as TURNSTILE_SITE_KEY
npx wrangler deploy
```

The feed then advertises the public site key, so the page renders the widget by
itself: no frontend rebuild and no site key in the JavaScript bundle. With
either half missing the gate is simply off, and `/api/health` reports
`commentTurnstile: false`.

Deploy the Worker (`npx wrangler deploy`). Until then the page says the wall is
not switched on, rather than showing a form that cannot work. No key is needed in
the frontend: every browser generates and holds its own anonymous identity.

### 5. Deploy from GitHub instead (optional)

`.github/workflows/deploy-worker.yml` deploys on every push to `worker/`. It
needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

### Local development

```bash
cp .env.example .env                 # fill in GEMINI_API_KEY
npx wrangler d1 migrations apply tickspy-comments --local
npx wrangler dev                     # http://localhost:8787
npm test                             # every suite, no network needed
```

For local comments, put a throwaway `COMMENTS_ADMIN_TOKEN` in `.dev.vars`. Then
`node scripts/comments.mjs list --local` reads the local queue, and
`REACT_APP_COMMENTS_API=http://127.0.0.1:8787 npm start` points a local frontend
at the Worker.

`npm test` runs `tests/all.js`, which runs every suite and fails if any does:
`run.js` (feeds, cache, bars, calendar, the handler and the crons), `comments.js`
(text cleaning, nicknames, the filter, ownership on delete, rate limits, the
Origin gate, admin auth), `research.js` and `research-api.js` (the brief, the
range model and the routes that serve it). The comment suite uses an
in-memory stand-in for D1; the SQL itself is exercised against a real database by
`wrangler dev` (see below).

`scripts/live-check.mjs` drives the same endpoints inside workerd against a real
KV namespace, which is where a binding or a module the runtime refuses to load
shows up:

```bash
npx wrangler dev --port 8791 --test-scheduled
BASE=http://127.0.0.1:8791 node scripts/live-check.mjs
```

`--test-scheduled` also fires the crons by hand:

```bash
curl "http://127.0.0.1:8791/__scheduled?cron=17+5+*+*+*"
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
- The read-only endpoints accept no caller-supplied text: `/api/overview` is
  built entirely from our own cached feeds and calendar, so there is no
  prompt-injection path and no free Gemini proxy. The two writable surfaces are
  the alert routes (validated, Origin-gated, token-scoped) and the comment wall
  (see its section) — nothing they accept is ever sent to a model.
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
