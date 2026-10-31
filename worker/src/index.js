/* TickSPY edge API — Cloudflare Worker.
 *
 * Endpoints
 *   GET /api/overview   cached Gemini market overview (the expensive one)
 *   GET /api/news       aggregated market headlines from six free feeds
 *   GET /api/calendar   the economic calendar, relayed past its CORS block
 *   GET /api/bars       keyless price data: the last completed session
 *   GET /api/health     cache ages and per-source status, for debugging
 *
 *   GET    /api/comments        the anonymous community wall
 *   POST   /api/comments        post as a browser-generated pseudonym
 *   DELETE /api/comments/:id    delete your own comment
 *   GET    /api/comments/admin  moderation queue (token required)
 *   POST   /api/comments/admin/:id  hide, show or delete (token required)
 *
 * Everything an API key touches lives here. The browser only ever sees our own
 * JSON, never a key, and never talks to Gemini or to a feed directly.
 *
 * Caching in one line: the Cron Trigger rebuilds the overview every 20 minutes,
 * visitors always read from cache, so the number of Gemini calls follows the
 * clock and not the audience.
 */

import { cached, warm } from "./cache.js";
import { collectNews } from "./news.js";
import { fetchSeries, knownInterval } from "./bars.js";
import { generateOverview, DEFAULT_MODEL } from "./gemini.js";
import { produceCalendar } from "./calendar.js";
import { alertRoutes } from "./alertapi.js";
import { commentRoutes, turnstileEnabled } from "./comments.js";
import { telegramBot } from "./telegram.js";
import { runAlertTick } from "./alerts.js";
import { buildSymbolResearch, buildMarketResearch } from "./research.js";
import { _memory as MEM, ALERTS_CRON, BARS_CRON, barsKey, budgetAllows, researchKey } from "./internals.js";

/* Everything the tests need to reach - the per-isolate cache, the cron
 * expressions, the bearer of the fetch budget - lives in internals.js, and
 * NOTHING but functions and the default handler is exported from this module.
 *
 * That is a hard requirement of the runtime, not a preference: workerd validates
 * the entry module's export map when the Worker starts and refuses to boot at all
 * if it finds a non-function export ("Incorrect type for map entry"). Since Node
 * exports anything without complaint, a stray `export const` here passes every
 * test and then takes the whole API down on deploy - which is how this comment
 * came to be written. `MEM` is the same object the tests import under its own
 * name. */

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

/* Price bars change once a day, when the previous session is final. A long TTL
 * plus the daily cron is the whole "updates daily" story: the refresh follows
 * the clock, not the audience, and a visitor is always reading an entry the cron
 * wrote. The TTL is just under a day so the cron always wins the race, and the
 * generous grace means a failed run serves the last good session rather than an
 * error. */
const BARS_TTL = 20 * 3600;
const BARS_GRACE = 4 * 86400;

/* A research brief is built from the same completed daily bars, so it follows
 * the same clock. The longer grace means a failed rebuild still serves the last
 * good brief rather than an error page; the brief says which session it is as
 * of, so an old one cannot be mistaken for a fresh one. */
const RESEARCH_TTL = 20 * 3600;
const RESEARCH_GRACE = 4 * 86400;

/* The cron expressions live in internals.js. /api/alerts/config reports the tick
 * interval from the same constant TICK_MINUTES in alertapi.js, so the schedule
 * and the sentence the desk shows a visitor cannot drift apart. */

/** How many symbols one request may ask for. */
const MAX_SYMBOLS = 12;

/*
 * Origins allowed to call this API. Two kinds of entry:
 *
 *   - an exact origin, e.g. https://tickspy.example.com
 *   - a host suffix, e.g. *.netlify.app, which matches any subdomain of it
 *
 * The suffix form exists because moving this site to another host used to break
 * the desk's no-key mode silently: the browser blocks the response, and all the
 * visitor sees is a chart that never loads. Netlify makes that worse by giving
 * every deploy preview its own random subdomain, which cannot be listed ahead of
 * time.
 *
 * This is not the security boundary. Every endpoint is a public, read-only GET
 * that returns the same cached payload to every caller: no credentials, no
 * cookies, no per-user data, nothing to authorise. What protects the upstream
 * quota is the per-isolate request budget (see BARS_FETCH_BUDGET), not this list.
 * The list exists so the API is not embedded by any site that happens to find it,
 * which is why hosts are named here rather than opened up with "*".
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://sdmtchebe.github.io",
  "http://localhost:3000",
  "http://localhost:8000",
  "http://localhost:8767",
  "*.netlify.app",
  "*.netlify.com",
];

function allowedOrigins(env) {
  const raw = env && typeof env.ALLOWED_ORIGINS === "string" ? env.ALLOWED_ORIGINS.trim() : "";
  // An explicit ALLOWED_ORIGINS replaces the defaults, so a deployment can
  // narrow the list. wrangler.toml sets it, which is why the patterns live there
  // too and not only here.
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The origin to echo back, or null when this origin is not allowed. */
function originAllowed(origin, allow) {
  // A wildcard is granted to every caller, exactly as it was before origin
  // patterns existed: it does not depend on the request carrying an Origin.
  if (allow.includes("*")) return "*";
  if (!origin) return null;
  if (allow.includes(origin)) return origin;

  let host;
  let protocol;
  try {
    const url = new URL(origin);
    host = url.host;
    protocol = url.protocol;
  } catch (e) {
    return null; // not a URL at all, which includes the literal "null" origin
  }
  // Only real web origins. data:, file: and javascript: URLs never get a grant.
  if (protocol !== "http:" && protocol !== "https:") return null;

  for (const raw of allow) {
    // Accept both "*.netlify.app" and "https://*.netlify.app", because the
    // scheme is meaningless here (only http and https get this far) and writing
    // it out is the natural thing to do.
    const entry = raw.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
    if (!entry.startsWith("*.")) continue;
    const suffix = entry.slice(1); // ".netlify.app"
    // The leading dot matters: it keeps "evilnetlify.app" from matching.
    if (host.length > suffix.length && host.endsWith(suffix)) return origin;
  }
  return null;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const granted = originAllowed(origin, allowedOrigins(env));
  const headers = {
    Vary: "Origin",
    // POST and DELETE are allowed because the alert and comment routes need
    // them. Those are the only writable endpoints, and each re-checks the
    // Origin or the bearer token itself before touching anything — the header
    // here only tells a browser what is possible, and a browser is the one
    // participant that always tells the truth about where a request came from.
    // Authorization is what the community identity and the moderation token
    // travel in; without it listed, a preflight would block both.
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (granted) headers["Access-Control-Allow-Origin"] = granted;
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

/* ---------------------------------------------------------------- calendar --
 * The calendar is assembled in calendar.js: the provider's rated week plus the
 * forward weeks Nasdaq publishes, which is what lets the desk open the week
 * after this one. Unrated Nasdaq rows are deliberately labelled "not rated"
 * rather than guessed at.
 */

/** The next few high-impact USD events, used both for the AI prompt and the UI. */
export function upcomingEvents(events, { limit = 8, from = Date.now() } = {}) {
  return events
    .filter((e) => e.country === "USD" && /High|Medium/i.test(e.impact))
    .filter((e) => {
      const t = Date.parse(e.date);
      return Number.isFinite(t) && t >= from;
    })
    // Calendar feeds can arrive week by week, so the order is not guaranteed.
    // Sorting here makes "the next event" mean the next one in time.
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, limit)
    .map((e) => ({
      title: e.title,
      impact: e.impact,
      when: e.date,
      forecast: e.forecast,
      previous: e.previous,
    }));
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

/* --------------------------------------------------------------- research --
 * The brief is computed from daily bars, never from a language model. The
 * endpoint takes a symbol, not a prompt: there is no user text in the request
 * and therefore no prompt-injection surface. The facts and the model are the
 * product; the prose is a deterministic rendering of them.
 *
 * Only the desk's default symbols get a durable KV entry. An arbitrary ticker
 * is still researchable, but it lives in the per-isolate memory cache only,
 * which is the same rule the bars path uses: a script walking the ticker
 * universe must not be able to fill the namespace.
 */

async function produceSymbolResearch(env, ctx, symbol) {
  const req = new Request("https://worker.local/api/research/brief");
  const main = await getBars(req, env, ctx, symbol, "1Day");
  const [bench, cal] = await Promise.all([
    getBars(req, env, ctx, "QQQ", "1Day").catch(() => null),
    getCalendar(req, env, ctx).catch(() => ({ value: [] })),
  ]);
  return buildSymbolResearch({
    symbol,
    bars: main.value.bars,
    benchmarkBars: bench ? bench.value.bars : null,
    benchmarkSymbol: "QQQ",
    events: upcomingEvents(cal.value || [], { limit: 8 }),
    source: main.value.source || null,
    asOf: main.value.asOf || main.value.sessionDate || null,
  });
}

async function produceMarketResearch(env, ctx) {
  const req = new Request("https://worker.local/api/research/market");
  const symbols = warmSymbols(env);
  const settled = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const r = await getBars(req, env, ctx, symbol, "1Day");
        return {
          symbol,
          bars: r.value.bars,
          source: r.value.source || null,
          asOf: r.value.asOf || r.value.sessionDate || null,
        };
      } catch (_) {
        return null;
      }
    })
  );
  const series = settled.filter((s) => s && Array.isArray(s.bars) && s.bars.length);
  if (!series.length) {
    throw new Error("No daily series were available for the market brief.");
  }
  const cal = await getCalendar(req, env, ctx).catch(() => ({ value: [] }));
  const asOf = series
    .map((s) => s.asOf)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const brief = buildMarketResearch({
    series,
    events: upcomingEvents(cal.value || [], { limit: 8 }),
    asOf,
  });
  // A transient SPY failure must not be cached for 20 hours as "unavailable".
  if (!brief.available) throw new Error(brief.message || "The market brief is unavailable.");
  return brief;
}

async function getSymbolResearch(request, env, ctx, symbol) {
  const durable = warmSymbols(env).includes(symbol) ? env.CACHE || null : null;
  return cached({
    kv: durable,
    mem: MEM,
    key: researchKey(symbol),
    ttlSeconds: RESEARCH_TTL,
    graceSeconds: RESEARCH_GRACE,
    ctx,
    produce: () => produceSymbolResearch(env, ctx, symbol),
  });
}

async function getMarketResearch(request, env, ctx) {
  return cached({
    kv: env.CACHE || null,
    mem: MEM,
    key: researchKey("market"),
    ttlSeconds: RESEARCH_TTL,
    graceSeconds: RESEARCH_GRACE,
    ctx,
    produce: () => produceMarketResearch(env, ctx),
  });
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

    /* Telegram alerts are the one part of this API that writes, so they are
     * routed before the read-only guard below. Everything they accept is
     * validated inside alertapi.js, including the Origin, because a
     * subscription is the only thing here that belongs to one person rather
     * than to everybody. The bot's webhook is routed there too: it carries no
     * Origin (Telegram is a server, not a page) and authenticates with the
     * secret token in its own header instead. */
    try {
      const alertResponse = await alertRoutes({
        request,
        env,
        ctx,
        url,
        json,
        originAllowed: (o) => originAllowed(o, allowedOrigins(env)),
      });
      if (alertResponse) return alertResponse;
    } catch (e) {
      return json(
        { error: "alert_failed", message: String((e && e.message) || e) },
        { status: 500, request, env }
      );
    }

    /* The community wall. It is separated from the alerts because it has its
     * own credential (an anonymous browser token, not a subscription secret)
     * and its own abuse budget. A failure here returns a fixed sentence rather
     * than the internal message: the only thing that can throw is the database,
     * and a driver error can name columns. */
    try {
      const commentResponse = await commentRoutes({
        request,
        env,
        url,
        json,
        originAllowed: (o) => originAllowed(o, allowedOrigins(env)),
      });
      if (commentResponse) return commentResponse;
    } catch (e) {
      console.error("[comments]", (e && e.message) || e);
      return json(
        { error: "comments_failed", message: "The community wall is unavailable right now. Try again in a moment." },
        { status: 500, request, env }
      );
    }

    // The rest of the API is read-only: everything below is a GET.
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
              // Booleans and one public name - never the token: are the pieces
              // Telegram alerts need actually present on this deployment?
              configured: {
                geminiKey: Boolean(env.GEMINI_API_KEY),
                kv: Boolean(env.CACHE),
                // True only when both the token (secret) and the public bot
                // username are usable, because a bot that can send but cannot
                // be linked to is not a working channel.
                telegram: Boolean(telegramBot(env)),
                telegramBot: (telegramBot(env) || {}).username || null,
                telegramWebhookSecret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
                comments: Boolean(env.COMMENTS_DB),
                commentModeration: Boolean(env.COMMENTS_ADMIN_TOKEN),
                // True only when the bot gate has both halves: the public site
                // key (a var) and the secret. Half a configuration posts
                // exactly as before, which is why it is reported as false.
                commentTurnstile: turnstileEnabled(env),
              },
              cacheAgeSeconds: mem,
              ttl: { overview: OVERVIEW_TTL, news: NEWS_TTL, calendar: CALENDAR_TTL, bars: BARS_TTL, research: RESEARCH_TTL },
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

        case "/api/research/brief": {
          const raw = (url.searchParams.get("symbol") || "SPY").trim();
          if (!/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(raw)) {
            return json(
              { error: "bad_symbol", message: "That does not look like a US ticker symbol." },
              { status: 400, request, env }
            );
          }
          const symbol = raw.toUpperCase();
          try {
            const r = await getSymbolResearch(request, env, ctx, symbol);
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
          } catch (e) {
            const message = String((e && e.message) || e);
            const notFound = /no data for that symbol|recognisable ticker/i.test(message);
            return json(
              { error: notFound ? "unknown_symbol" : "research_unavailable", message },
              { status: notFound ? 404 : 502, request, env }
            );
          }
        }

        case "/api/research/market": {
          try {
            const r = await getMarketResearch(request, env, ctx);
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
          } catch (e) {
            return json(
              { error: "research_unavailable", message: String((e && e.message) || e) },
              { status: 502, request, env }
            );
          }
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
          return json(
            {
              error: "Not found",
              endpoints: [
                "/api/overview",
                "/api/news",
                "/api/calendar",
                "/api/bars",
                "/api/research/brief",
                "/api/research/market",
                "/api/health",
                "/api/alerts/config",
                "/api/alerts/link/start",
                "/api/alerts/link/status",
                "/api/alerts/rules",
                "/api/comments",
                "/api/alerts/test",
                "/api/alerts/unsubscribe",
                "/api/telegram/webhook",
              ],
            },
            { status: 404, request, env }
          );
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

    /* Telegram alerts run on their own schedule, before anything else, because
     * the tick is cheap when nothing is due and it should not have to wait
     * behind a news refresh to find out. It reads the news and calendar that
     * are already cached rather than fetching its own copy. */
    if (event && event.cron === ALERTS_CRON) {
      try {
        const req = new Request("https://worker.local/api/alert-tick");
        // Both are cache reads on a warm entry, and both are already refreshed
        // on their own schedules. A cold cache here returns nothing rather than
        // failing the tick, so an alert run can never be the thing that breaks.
        const [news, cal] = await Promise.all([
          getNews(req, env, ctx, "").then((r) => r.value.news || []).catch(() => []),
          getCalendar(req, env, ctx).then((r) => r.value || []).catch(() => []),
        ]);
        const summary = await runAlertTick({ env, news, events: cal });
        console.log(
          `cron: alerts checked ${summary.checked}, sent ${summary.sent}, removed ${summary.removed}, deferred ${summary.skipped}`
        );
        for (const err of summary.errors) console.error(`cron: alerts ${err}`);
      } catch (e) {
        console.error(`cron: alerts failed: ${(e && e.message) || e}`);
      }
      return;
    }

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

      // Research reads those same daily bars. Rebuilding it here means the
      // first visitor after the cron reads a warm brief, and the walk-forward
      // model is computed once for everyone rather than once per cold isolate.
      const research = await Promise.allSettled([
        ...warmSymbols(env).map(async (s) => {
          const r = await warm({
            kv,
            mem: MEM,
            key: researchKey(s),
            produce: () => produceSymbolResearch(env, ctx, s),
          });
          console.log(
            `cron: research ${s} refreshed (${r.value.available ? `${r.value.sessions} sessions` : "not enough history"})`
          );
        }),
        (async () => {
          const r = await warm({
            kv,
            mem: MEM,
            key: researchKey("market"),
            produce: () => produceMarketResearch(env, ctx),
          });
          console.log(`cron: research market refreshed (${r.value.facts.breadth.total} symbols)`);
        })(),
      ]);
      for (const r of research) {
        if (r.status === "rejected") console.error(`cron: research refresh failed: ${(r.reason && r.reason.message) || r.reason}`);
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
