/* TickSPY edge API — Cloudflare Worker.
 *
 * Endpoints
 *   GET /api/overview   cached Gemini market overview (the expensive one)
 *   GET /api/news       aggregated market headlines from six free feeds
 *   GET /api/calendar   the economic calendar, relayed past its CORS block
 *   GET /api/bars       keyless price data: the last completed session
 *   GET /api/health     cache ages and per-source status, for debugging
 *
 * Everything an API key touches lives here. The browser only ever sees our own
 * JSON, never a key, and never talks to Gemini or to a feed directly.
 *
 * Caching in one line: the Cron Trigger rebuilds the overview every 20 minutes,
 * visitors always read from cache, so the number of Gemini calls follows the
 * clock and not the audience.
 */

import { cached, createMemory, warm } from "./cache.js";
import { collectNews } from "./news.js";
import { fetchSeries, knownInterval } from "./bars.js";
import { generateOverview, DEFAULT_MODEL } from "./gemini.js";

// Per-isolate, survives between requests handled by the same instance.
const MEM = createMemory();

// Exposed so tests can reset the per-isolate cache between cases; production
// code only ever goes through the routes above.
export const _memory = MEM;

const CALENDAR_UPSTREAM = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const KEYS = {
  overview: "overview:v1",
  news: "news:v1",
  calendar: "calendar:v1",
};

// Price bars are cached per symbol and timeframe. The version prefix means a
// payload-shape change can be shipped without serving a half-migrated entry, and
// v2 is exactly that: the intraday payload went from one session to the last
// three, and a stale entry would have quietly kept the desk on the old shape
// until its 20-hour TTL ran out.
//
// The `l` variant is the light range the symbol-list path asks for. It gets its
// own key on purpose: one key cannot hold two different histories, and when the
// watchlist and the detail view shared it, whichever wrote first decided how much
// history the other saw - which quietly turned a relative-strength comparison
// into five years for one symbol and three months for the other.
export const BARS_KEY_PREFIX = "bars:v2";
const barsKey = (tf, symbol, light = false) => `${BARS_KEY_PREFIX}${light ? "l" : ""}:${tf}:${String(symbol).toUpperCase()}`;

// 25-minute TTL with a 20-minute cron: the schedule refreshes each entry before
// it expires, so a visitor almost never pays for a rebuild.
const OVERVIEW_TTL = 1500;
const OVERVIEW_GRACE = 3600;
const NEWS_TTL = 180;
const NEWS_GRACE = 900;
const CALENDAR_TTL = 3600;
const CALENDAR_GRACE = 21600;

/* Price bars change once a day, when the previous session is final. A long TTL
 * plus the daily cron is the whole "updates daily" story: the refresh follows
 * the clock, not the audience, and a visitor is always reading an entry the cron
 * wrote. The TTL is just under a day so the cron always wins the race, and the
 * generous grace means a failed run serves the last good session rather than an
 * error. */
const BARS_TTL = 20 * 3600;
const BARS_GRACE = 4 * 86400;

/** The daily cron. Anything else on the schedule leaves price bars alone. */
export const BARS_CRON = "17 5 * * *";

/** How many symbols one request may ask for. */
const MAX_SYMBOLS = 12;

function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "https://sdmtchebe.github.io,http://localhost:3000,http://localhost:8000,http://localhost:8767";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allow = allowedOrigins(env);
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (allow.includes("*") || allow.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = allow.includes("*") ? "*" : origin;
  }
  return headers;
}

function json(body, { status = 200, request, env, cache = "no-store", extra = {} } = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

/* ---------------------------------------------------------------- calendar -- */
function normaliseCalendar(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && e.title && e.date)
    .map((e) => ({
      title: String(e.title),
      country: String(e.country || ""),
      date: String(e.date),
      impact: String(e.impact || ""),
      forecast: e.forecast == null ? "" : String(e.forecast),
      previous: e.previous == null ? "" : String(e.previous),
      actual: e.actual == null ? "" : String(e.actual),
    }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** The next few high-impact USD events, used both for the AI prompt and the UI. */
export function upcomingEvents(events, { limit = 8, from = Date.now() } = {}) {
  return events
    .filter((e) => e.country === "USD" && /High|Medium/i.test(e.impact))
    .filter((e) => {
      const t = Date.parse(e.date);
      return Number.isFinite(t) && t >= from;
    })
    .slice(0, limit)
    .map((e) => ({
      title: e.title,
      impact: e.impact,
      when: e.date,
      forecast: e.forecast,
      previous: e.previous,
    }));
}

async function produceCalendar() {
  const res = await fetch(CALENDAR_UPSTREAM, {
    headers: { "User-Agent": "TickSPY/1.0 (+https://github.com/sdmtchebe/tickspy)" },
    cf: { cacheTtl: 1800, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`calendar upstream ${res.status}`);
  return normaliseCalendar(await res.json());
}

async function getCalendar(request, env, ctx) {
  return cached({
    kv: env.CACHE || null,
    mem: MEM,
    key: KEYS.calendar,
    ttlSeconds: CALENDAR_TTL,
    graceSeconds: CALENDAR_GRACE,
    ctx,
    produce: produceCalendar,
  });
}

/* -------------------------------------------------------------------- news -- */
/* -------------------------------------------------------------------- bars --
 * The no-key data path. A visitor with no Alpaca account still sees a real,
 * complete previous session, because the fetch happens here instead of in their
 * browser: Stooq sends no CORS headers and could not be read from a static page.
 *
 * Abuse is bounded rather than trusted. The ticker is validated before it can
 * reach a URL, the symbol list is capped, and only the symbols in DESK_SYMBOLS
 * are written to the durable cache - an arbitrary ticker is served from the
 * per-isolate memory cache only, so a script cannot fill the KV namespace or
 * burn its write quota. Every response is cached for a day either way.
 */

function warmSymbols(env) {
  const raw = (env && env.DESK_SYMBOLS) || "SPY,QQQ,AAPL,NVDA,TSLA,MSFT,AMZN,META,GOOGL,IWM,DIA";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
}

/* Stooq's free feed publishes a low daily request quota, and /api/bars is the
 * one endpoint that takes a caller-supplied symbol. Without a limit, a script
 * could walk through ticker after ticker and spend that quota on symbols no
 * visitor asked for, leaving the desk's own list unserved. A per-isolate token
 * bucket bounds it: at most BARS_FETCH_BUDGET missing entries may start an
 * upstream fetch per window. Past that the endpoint answers with a sentence
 * instead of calling upstream again. It is a speed bump rather than a wall -
 * Cloudflare runs many isolates - but together with the durable cache holding
 * only DESK_SYMBOLS it keeps the quota pointed at symbols people actually look
 * at. Cached and stale entries are untouched, so ordinary traffic never sees it. */
const BARS_FETCH_WINDOW_MS = 60_000;
const BARS_FETCH_BUDGET = 60;
const FETCH_HITS = [];
let FETCH_BLOCKED = 0;

/** Exported so the tests can drive the clock and read the block count. */
export const _fetchBudget = {
  windowMs: BARS_FETCH_WINDOW_MS,
  max: BARS_FETCH_BUDGET,
  get hits() {
    return FETCH_HITS;
  },
  get blocked() {
    return FETCH_BLOCKED;
  },
};

export function budgetAllows(now = Date.now()) {
  // Drop the timestamps that have aged out of the window, then admit one more
  // only if the window still has room.
  while (FETCH_HITS.length && now - FETCH_HITS[0] >= BARS_FETCH_WINDOW_MS) FETCH_HITS.shift();
  if (FETCH_HITS.length >= BARS_FETCH_BUDGET) {
    FETCH_BLOCKED++;
    return false;
  }
  FETCH_HITS.push(now);
  return true;
}

async function getBars(request, env, ctx, symbol, tf, light = false) {
  const upper = String(symbol).toUpperCase();
  const durable = warmSymbols(env).includes(upper) ? env.CACHE || null : null;
  return cached({
    kv: durable,
    mem: MEM,
    key: barsKey(tf, upper, light),
    ttlSeconds: BARS_TTL,
    graceSeconds: BARS_GRACE,
    ctx,
    produce: () => {
      if (!budgetAllows()) {
        throw new Error("Too many price requests right now. Please try again in a minute.");
      }
      return fetchSeries({ symbol: upper, tf, zone: (env && env.STOOQ_ZONE) || null, light });
    },
  });
}

async function handleBars(request, env, ctx, url) {
  const tf = url.searchParams.get("tf") || "1Day";
  if (!knownInterval(tf)) {
    return json(
      { error: "bad_tf", message: `Unsupported timeframe: ${tf}`, allowed: ["1Day", "5Min", "15Min"] },
      { status: 400, request, env }
    );
  }

  const multi = url.searchParams.get("symbols");
  if (multi !== null) {
    const list = multi
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS);
    if (!list.length) return json({ error: "bad_symbol", message: "No symbols given." }, { status: 400, request, env });

    // `light` on this path: a symbol list is a watchlist or a relative-strength
    // pair, which needs a quote and a short window per symbol, not a deep history.
    // Parsing a full daily range for each entry is what pushed the request over
    // the free plan's 10 ms CPU budget (Cloudflare error 1102).
    const settled = await Promise.all(
      list.map(async (s) => {
        try {
          const r = await getBars(request, env, ctx, s, tf, true);
          return [s, r];
        } catch (e) {
          return [s, { error: String((e && e.message) || e) }];
        }
      })
    );

    const bars = {};
    const errors = {};
    let age = 0;
    let hit = true;
    let asOf = null;
    // Which upstream actually answered, per symbol. Reporting a single source
    // for the batch was a lie the moment there were two of them, and the desk
    // surfaces this string.
    const sources = new Set();
    for (const [s, r] of settled) {
      if (r.error) {
        errors[s] = r.error;
        continue;
      }
      // Daily series carry the closes the watchlist needs; the intraday series
      // carry the session itself.
      bars[s] = r.value.bars;
      if (r.value.source) sources.add(r.value.source);
      asOf = asOf || r.value.asOf;
      age = Math.max(age, r.ageSeconds || 0);
      if (!r.cached) hit = false;
    }
    if (!Object.keys(bars).length) {
      return json(
        { error: "unavailable", message: "No price data was available for those symbols.", errors },
        { status: 502, request, env }
      );
    }
    const sourceList = [...sources];
    return json(
      {
        tf,
        source: sourceList.length === 1 ? sourceList[0] : sourceList.length ? "mixed" : null,
        delayed: true,
        asOf,
        bars,
        errors,
        cache: { hit, ageSeconds: age },
      },
      { request, env, cache: "public, max-age=600, s-maxage=3600" }
    );
  }

  const symbol = url.searchParams.get("symbol") || "SPY";
  let r;
  try {
    r = await getBars(request, env, ctx, symbol, tf);
  } catch (e) {
    const message = String((e && e.message) || e);
    const notFound = /no data for that symbol|recognisable ticker/i.test(message);
    return json({ error: notFound ? "unknown_symbol" : "unavailable", message }, { status: notFound ? 404 : 502, request, env });
  }
  return json(
    {
      ...r.value,
      cache: { hit: r.cached, stale: r.stale, ageSeconds: r.ageSeconds },
    },
    {
      request,
      env,
      cache: "public, max-age=600, s-maxage=3600",
      extra: { "X-Cache": r.cached ? (r.stale ? "STALE" : "HIT") : "MISS" },
    }
  );
}

async function getNews(request, env, ctx, q) {
  return cached({
    kv: env.CACHE || null,
    mem: MEM,
    key: KEYS.news,
    ttlSeconds: NEWS_TTL,
    graceSeconds: NEWS_GRACE,
    ctx,
    produce: () => collectNews({ limit: 80 }),
    meta: { q: q || null },
  });
}

/* ---------------------------------------------------------------- overview -- */
/** Build a fresh overview. Never reads anything the caller supplied. */
async function produceOverview(env, ctx) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }
  // Reuse the cached news and calendar: they refresh on their own schedules.
  const req = new Request("https://worker.local/api/overview");
  const news = await getNews(req, env, ctx, "");
  const cal = await getCalendar(req, env, ctx);
  const events = upcomingEvents(cal.value, { limit: 8 });

  const overview = await generateOverview({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL || DEFAULT_MODEL,
    news: news.value.news,
    events,
  });

  return {
    text: overview.text,
    model: overview.model,
    generatedAt: new Date().toISOString(),
    // Kept small, and shown in the UI so the summary is auditable.
    headlines: news.value.news.slice(0, 8).map((n) => ({
      title: n.title,
      source: n.source,
      url: n.url,
      publishedAt: n.publishedAt,
    })),
    events,
    sourcesUsed: news.value.sources.filter((s) => s.ok).map((s) => s.source),
  };
}

async function getOverview(request, env, ctx) {
  return cached({
    kv: env.CACHE || null,
    mem: MEM,
    key: KEYS.overview,
    ttlSeconds: OVERVIEW_TTL,
    graceSeconds: OVERVIEW_GRACE,
    ctx,
    produce: () => produceOverview(env, ctx),
  });
}

/* ------------------------------------------------------------------ routes -- */
export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    // Read-only API: everything here is a GET, so anything else is a 405.
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405, request, env });
    }

    try {
      switch (url.pathname) {
        case "/api/health": {
          const mem = {};
          for (const [k, v] of MEM.entries()) mem[k] = Math.round((Date.now() - v.at) / 1000);
          return json(
            {
              ok: true,
              model: env.GEMINI_MODEL || DEFAULT_MODEL,
              // Booleans only - never the values.
              configured: { geminiKey: Boolean(env.GEMINI_API_KEY), kv: Boolean(env.CACHE) },
              cacheAgeSeconds: mem,
              ttl: { overview: OVERVIEW_TTL, news: NEWS_TTL, calendar: CALENDAR_TTL, bars: BARS_TTL },
              deskSymbols: warmSymbols(env),
            },
            { request, env }
          );
        }

        case "/api/news": {
          const q = (url.searchParams.get("q") || "").slice(0, 40).replace(/[^\w\s&.-]/g, "");
          const r = await getNews(request, env, ctx, q);
          return json(
            {
              news: r.value.news,
              sources: r.value.sources,
              sourcesOk: r.value.sourcesOk,
              sourcesTotal: r.value.sourcesTotal,
              fetchedAt: r.value.fetchedAt,
              cache: { hit: r.cached, stale: r.stale, ageSeconds: r.ageSeconds },
            },
            {
              request,
              env,
              // Let browsers and Cloudflare share this briefly too.
              cache: "public, max-age=60, s-maxage=120",
              extra: { "X-Cache": r.cached ? (r.stale ? "STALE" : "HIT") : "MISS" },
            }
          );
        }

        case "/api/bars":
          return await handleBars(request, env, ctx, url);

        case "/api/calendar": {
          const r = await getCalendar(request, env, ctx);
          return json(
            {
              events: r.value,
              cache: { hit: r.cached, stale: r.stale, ageSeconds: r.ageSeconds },
            },
            {
              request,
              env,
              cache: "public, max-age=300, s-maxage=600",
              extra: { "X-Cache": r.cached ? (r.stale ? "STALE" : "HIT") : "MISS" },
            }
          );
        }

        case "/api/overview": {
          if (!env.GEMINI_API_KEY) {
            return json(
              {
                error: "not_configured",
                message:
                  "The AI overview is not configured on this server. Set the GEMINI_API_KEY secret to enable it.",
              },
              { status: 503, request, env }
            );
          }
          const r = await getOverview(request, env, ctx);
          return json(
            {
              ...r.value,
              cache: { hit: r.cached, stale: r.stale, ageSeconds: r.ageSeconds },
            },
            {
              request,
              env,
              cache: "public, max-age=300, s-maxage=600",
              extra: { "X-Cache": r.cached ? (r.stale ? "STALE" : "HIT") : "MISS" },
            }
          );
        }

        default:
          return json({ error: "Not found", endpoints: ["/api/overview", "/api/news", "/api/calendar", "/api/bars", "/api/health"] }, { status: 404, request, env });
      }
    } catch (e) {
      // Last resort: the cached layer already serves stale values where it can,
      // so reaching here means there is nothing at all to serve.
      return json(
        { error: "upstream_unavailable", message: String((e && e.message) || e) },
        { status: 502, request, env }
      );
    }
  },

  /* Fired by the Cron Trigger in wrangler.toml.
   *
   * This uses warm() rather than the request path: cached() would happily return
   * the still-fresh entry and the cron would then rebuild nothing. warm() always
   * calls the producer and overwrites, which is exactly what a scheduled
   * refresh is for. Order matters - news and calendar first, so the overview is
   * summarising the same run's data. */
  async scheduled(event, env = {}, ctx = {}) {
    const kv = env.CACHE || null;

    // Price bars belong to the daily run only. On the 20-minute schedule they
    // would be identical every time, and each extra rebuild spends one of
    // Stooq's daily requests for no new information.
    if (event && event.cron === BARS_CRON) {
      const results = await Promise.allSettled(
        warmSymbols(env).flatMap((s) =>
          ["1Day", "5Min"].map(async (tf) => {
            const r = await warm({
              kv,
              mem: MEM,
              key: barsKey(tf, s),
              produce: () => fetchSeries({ symbol: s, tf, zone: env.STOOQ_ZONE || null }),
            });
            console.log(`cron: bars ${s} ${tf} refreshed (${r.value.bars.length} bars, session ${r.value.sessionDate})`);
          })
        )
      );
      for (const r of results) {
        if (r.status === "rejected") console.error(`cron: bars fetch failed: ${(r.reason && r.reason.message) || r.reason}`);
      }
      return;
    }

    const results = await Promise.allSettled([
      (async () => {
        const e = await warm({ kv, mem: MEM, key: KEYS.calendar, produce: produceCalendar });
        console.log(`cron: calendar refreshed (${e.value.length} events)`);
      })(),
      (async () => {
        const e = await warm({
          kv,
          mem: MEM,
          key: KEYS.news,
          produce: () => collectNews({ limit: 80 }),
        });
        console.log(
          `cron: news refreshed (${e.value.news.length} items, ${e.value.sourcesOk}/${e.value.sourcesTotal} sources)`
        );
      })(),
    ]);

    // The overview depends on the two above, so it runs after them.
    if (env.GEMINI_API_KEY) {
      try {
        const e = await warm({
          kv,
          mem: MEM,
          key: KEYS.overview,
          produce: () => produceOverview(env, ctx),
        });
        console.log(`cron: overview refreshed (${e.value.text.length} chars, model ${e.value.model})`);
      } catch (err) {
        console.error(`cron: overview failed: ${(err && err.message) || err}`);
      }
    } else {
      console.log("cron: GEMINI_API_KEY not set, skipped the overview");
    }

    for (const r of results) {
      if (r.status === "rejected") console.error(`cron: ${(r.reason && r.reason.message) || r.reason}`);
    }
  },
};
