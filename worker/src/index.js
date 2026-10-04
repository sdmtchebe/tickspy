/* TickSPY edge API — Cloudflare Worker.
 *
 * Endpoints
 *   GET /api/overview   cached Gemini market overview (the expensive one)
 *   GET /api/news       aggregated market headlines from six free feeds
 *   GET /api/calendar   the economic calendar, relayed past its CORS block
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

// 25-minute TTL with a 20-minute cron: the schedule refreshes each entry before
// it expires, so a visitor almost never pays for a rebuild.
const OVERVIEW_TTL = 1500;
const OVERVIEW_GRACE = 3600;
const NEWS_TTL = 180;
const NEWS_GRACE = 900;
const CALENDAR_TTL = 3600;
const CALENDAR_GRACE = 21600;

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
              ttl: { overview: OVERVIEW_TTL, news: NEWS_TTL, calendar: CALENDAR_TTL },
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
          return json({ error: "Not found", endpoints: ["/api/overview", "/api/news", "/api/calendar", "/api/health"] }, { status: 404, request, env });
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
