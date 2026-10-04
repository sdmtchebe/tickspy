# TickSPY edge API

A small Cloudflare Worker that does the three things a static site cannot:

| Endpoint | What it does |
|---|---|
| `GET /api/overview` | A Gemini-written market overview, cached globally |
| `GET /api/news` | Market headlines aggregated from six free feeds |
| `GET /api/calendar` | The economic calendar, relayed past its CORS block |
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

Intervals: overview 25 min TTL / 20 min cron, news 3 min, calendar 1 h.

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

Paste the printed `id` into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

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
npm test                  # 31 tests, no network needed
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

If the Worker is not deployed yet, the desk simply falls back to its existing
behaviour, so nothing breaks in the meantime.

## Security notes

- The key is read from `env.GEMINI_API_KEY` inside the handler and used only in
  the `x-goog-api-key` header. It is never logged and never serialised.
- `/api/overview` takes **no user input**. The prompt is assembled entirely from
  our own cached headlines and calendar, so there is no prompt-injection path
  and no way for a visitor to use this as a free Gemini proxy.
- Upstream error bodies are never echoed: a Gemini failure returns
  `Gemini responded 429`, not the body, which could contain key-tied details.
- Responses carry `Vary: Origin` and only grant CORS to origins listed in
  `ALLOWED_ORIGINS`.
- `/api/health` reports booleans (`configured.geminiKey: true`), never values.
  A test asserts the secret cannot appear in any response.

## Data sources

News comes from six public RSS feeds, chosen by measuring freshness rather than
by reputation. At the time of writing: MarketWatch ~29 min, CNBC ~31 min,
Investing.com ~32 min, Seeking Alpha ~92 min, Nasdaq ~95 min. Alternatives that
looked good but were dropped as stale or dead: Yahoo Finance's index feed (~10
days), WSJ Markets and MarketWatch Market Pulse (frozen documents), Barron's
(403) and CNBC Economy (404).

Each source's health is reported in `/api/news`, so a feed going quiet is
visible instead of silently shrinking coverage.
