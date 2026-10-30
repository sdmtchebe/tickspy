# TickSPY edge API

A small Cloudflare Worker that does the things a static site cannot:

| Endpoint | What it does |
|---|---|
| `GET /api/overview` | A Gemini-written market overview, cached globally |
| `GET /api/news` | Market headlines aggregated from six free feeds |
| `GET /api/calendar` | The economic calendar: the provider's rated week plus three weeks beyond it |
| `GET /api/bars` | The previous completed session's prices, with no API key |
| `GET /api/health` | Cache ages and per-source status |
| `POST /api/alerts/*` | Telegram alerts: link a chat, save rules, send a test (see below) |
| `POST /api/telegram/webhook` | The bot's updates, authenticated by Telegram's secret header |

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

## Telegram alerts (`/api/alerts/*`, `/api/telegram/webhook`)

Everything above is read-only and the same for everybody. This is the one part
that belongs to one person, and the request behind it is specific: **tell me when
a price crosses a level, a headline lands or a release is due — without an
account, without paying, and without giving up my phone number.**

The channel is a Telegram bot. That was a deliberate change from browser push,
which worked but asked a lot of the person receiving it: a service worker per
browser, a VAPID key pair, an https origin, a Home-Screen install on iOS 16.4+,
and three push services that each behave differently. Telegram is one token, one
webhook, and the same message on a phone, a desktop client and the web client.
The trade is stated everywhere it matters: a Telegram message is private to the
chat but is **not end-to-end encrypted against Telegram itself**, which browser
push was. The desk and the privacy page say so in those words.

There is no SMS path. Texting an arbitrary number costs money per message and
needs carrier registration; the channel that replaces it is free and already
installed on most phones.

```
GET  /api/alerts/config          what this deployment can do (booleans, never values)
POST /api/alerts/link/start      make a one-time code  ->  { code, deepLink, expiresAt }
GET  /api/alerts/link/status     poll: has the bot consumed that code yet?
POST /api/alerts/rules           replace the rules on an existing record
POST /api/alerts/test            send one message now
POST /api/alerts/unsubscribe     delete the record and every rule in it
POST /api/telegram/webhook       Telegram's updates (secret header, no Origin)
```

Every desk route but `config` and `link/status` is a POST, is refused unless the
browser's `Origin` is in `ALLOWED_ORIGINS`, and answers with `Vary: Origin` plus a
CORS grant for that one origin. That gate is what stops a page linking a chat on
a visitor's behalf. The webhook is the opposite kind of caller — a server with no
Origin — so it is authenticated by `X-Telegram-Bot-Api-Secret-Token`, which is
the value Telegram was given when the webhook was registered.

### How a chat gets connected

```
desk                          worker                         Telegram
 │  POST /link/start            │                               │
 │ ────────────────────────────>│  code = 16 random bytes       │
 │ <──── { code, deepLink } ────│  stored 15 min, single use    │
 │                              │                               │
 │  window.open(t.me/bot?start=code) ───────────────────────────>│  chat opens
 │                              │        user presses START     │
 │                              │ <──── /start code ────────────│
 │  GET /link/status?code=…     │  chat id + rules saved        │
 │ ────────────────────────────>│  code marked used, credentials│
 │ <──── { id, token } ─────────│  kept for the code's lifetime │
```

The code is the only thing that joins the two halves, and it is the page's own
secret: 16 random bytes, generated in the browser's request, never shown to the
bot except as the deep-link payload the person themselves pressed. The chat id
never reaches the desk, and the desk's token never reaches the chat. Losing the
token costs nothing but a re-link, which replaces the record instead of adding a
second one for the same chat.

### What one subscription stores, and nothing else

```js
{ id, token, chatId, chatLabel, rules, createdAt, fired, lastSentAt }
```

- `chatId` is a number Telegram assigns to a conversation. It can be used to
  send to **that chat** and to nothing else; it is not a person, and it is
  deleted the moment the record is.
- `chatLabel` is the first name or the group title Telegram shows the bot, so the
  desk can say which chat it is. Nothing else about the account is stored.
- No phone number, no email, no IP address, no account. There is nothing here to
  look a person up by.
- `id` and `token` are handed to the desk that made the code and kept in that
  browser. The token is compared in constant time (`safeEqual`), so a record can
  only be changed or deleted by whoever holds it — and an unknown `id` is
  rejected before any lookup.
- The rule set is cleaned and bounded on every write: at most 20 price rules, 10
  news symbols, a calendar lead between 1 and 120 minutes, and any symbol that
  could reach a URL is refused.
- A `tgchat:<chatId>` index points at the record, so `/rules` and `/stop` can find
  it without listing the store, and it is deleted with the record.

### The tick

`*/5 * * * *` (see `internals.js`). Each run lists the subscriptions and asks
only what each subscriber's rules require — someone with no rules, or whose only
rules are already satisfied, costs no upstream request at all. Three properties
are deliberate:

- **Quiet is the default.** A rule that has fired stays quiet for `REARM_MS`
  (30 minutes) and only then speaks again, so a price sitting just above a level
  cannot notify on every tick.
- **A tick cannot run away.** At most `MAX_SENDS_PER_TICK` (20) messages leave one
  invocation, quotes are shared through a 60-second cache (`QUOTE_TTL_MS`), and
  `MAX_SUBSCRIPTIONS` (2000) caps the list — so 200 people watching `SPY` cost one
  upstream fetch, not 200.
- **A permanent failure deletes; a transient one retries.** A 403 from Telegram
  (the bot was blocked) or a `chat not found` is the chat saying it is gone, so
  the record is deleted. A 500 or a dropped connection is left in place, because
  an upstream having a bad minute must not silently unsubscribe somebody.

### What the bot answers

| Command | What it does |
| --- | --- |
| `/start <code>` | The link itself. Connects the chat, or re-connects it and keeps its rules. |
| `/start` | Three sentences explaining how to connect, with a link to the desk. |
| `/rules` | The same sentences the desk shows, from the same `rulesSummary()`. |
| `/test` | One test message, rate-limited to three a minute per chat. |
| `/stop` | Deletes the record and the chat index, and says so. |
| `/help` | The welcome text again. |

Telegram retries any update that does not get a 2xx, so the webhook answers 200
even for junk, a failed reply, or a command it does not implement. A duplicate
message is worse than a missing one: the person can send `/help` again, but a
retry loop would deliver the same sentence five times.

### The limits, stated in the UI rather than discovered later

- **Alerts are checked every five minutes** — "within about five minutes", not
  instant.
- **Alerts fire on the server's clock.** A price alert is not a resting order at
  a broker and executes nothing.
- **Telegram must be able to message you.** A bot cannot start a conversation, so
  nothing is ever sent until the person presses START. Blocking the bot deletes
  the record on the next tick.
- **Telegram carries the message.** It is private to the chat, but Telegram can
  read it — unlike the browser push payloads this replaced.

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
repo. `wrangler.toml` deliberately contains no key.

### 3. Turn Telegram alerts on (a bot, and two secrets)

One bot serves the whole deployment: every visitor links their own chat to it.
Create it once, in Telegram, by talking to [@BotFather](https://t.me/BotFather):

1. Send `/newbot`, then a name (`TickSPY Alerts`) and a username ending in
   `bot` (`tickspy_alerts_bot`, for example).
2. BotFather replies with a token that looks like `123456789:AAH…`. That token
   **is** the bot; treat it like a password and never paste it into a file in
   this repo.
3. Put the username — not the token — in `wrangler.toml` as
   `TELEGRAM_BOT_USERNAME`, and change `PUBLIC_SITE_URL` if the site is not at
   `https://tickspy.com`.

Then store the two secrets (each is prompted for, so neither lands in a file, a
shell history or a screenshot):

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN      # paste the BotFather token
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET # any long random string
```

Generate the second one with, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Deploy, then point Telegram at the Worker. This is the step that makes the bot
work: until it runs, pressing START goes nowhere.

```bash
npx wrangler deploy
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  node scripts/telegram-setup.mjs https://tickspy-api.<your-subdomain>.workers.dev
```

`telegram-setup.mjs` checks the token with `getMe`, warns if the token belongs to
a different bot than `TELEGRAM_BOT_USERNAME` says (the one mistake that silently
breaks every Connect button), sets the command menu, and registers the webhook
with the secret. Run it again after changing the Worker's URL.

Until all of this exists, `/api/alerts/config` answers `telegram: false` and the
desk says so plainly instead of offering a button that cannot work.

**Rotating the bot token** invalidates the old token immediately: set the new one
with `wrangler secret put`, redeploy, and run `telegram-setup.mjs` again. Chats
stay linked, because a chat id does not change when the token does.

### 4. Point the site at the Worker

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

### 5. Turn on comments (D1 and a moderation secret)

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

### 6. Deploy from GitHub instead (optional)

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

For the alert routes locally, put a **fake but well-formed** bot token in
`.dev.vars` (git-ignored), plus the webhook secret the live check expects:

```
TELEGRAM_BOT_TOKEN=123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
TELEGRAM_WEBHOOK_SECRET=webhook-check-secret-0123456789
```

The token is syntactically valid, so the code paths and `live-check.mjs` run,
and every send fails at the network boundary — which is exactly what a local run
should do. Nothing in this repo can reach a real bot without a real token.

`npm test` runs `tests/all.js`, which runs every suite and fails if any does:
`run.js` (feeds, cache, bars, calendar, the handler, the cron), `alerts.js` (the
rules, the tick, the link flow, the webhook, the message copy) and `comments.js`
(text cleaning, nicknames, the filter, ownership on delete, rate limits, the
Origin gate, admin auth). The alert suite records every request that would have
gone to `api.telegram.org`, so it can assert the chat id, the HTML-escaped text,
and that the token never appears in a body or a reply. The comment suite uses an
in-memory stand-in for D1; the SQL itself is exercised against a real database by
`wrangler dev` (see below).

`scripts/live-check.mjs` drives the same endpoints inside workerd against a real
KV namespace, which is where a binding or a module the runtime refuses to load
shows up:

```bash
npx wrangler dev --port 8791 --test-scheduled
BASE=http://127.0.0.1:8791 node scripts/live-check.mjs
```

`--test-scheduled` also fires the cron by hand, which is how the alert tick is
exercised without waiting five minutes:

```bash
curl "http://127.0.0.1:8791/__scheduled?cron=*/5+*+*+*+*"
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
