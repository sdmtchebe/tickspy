/* yahoo.js — the price source that actually answers.
 *
 * The desk's keyless mode was built on Stooq's free CSV. Stooq now refuses
 * Cloudflare's network outright: a fetch from a Worker either times out (522
 * after ~40 s) or is answered with an anti-bot HTML page, and the KV namespace
 * confirmed it had never once stored a bar. That is not a tuning problem, so the
 * source is replaced rather than retried.
 *
 * Yahoo's public chart endpoint answers a Worker in <200 ms from any colo with
 * the whole OHLCV series in one JSON document, and it is a strict improvement on
 * the CSV for two reasons beyond being reachable:
 *
 *   1. Every timestamp is an exact UTC instant, so none of the zone-guessing the
 *      CSV needed (whose clock is the file in? does it shift at DST?) applies.
 *      `meta.exchangeTimezoneName` states the zone outright.
 *   2. It returns ranges, not just "the last N days", so a single request gives
 *      the five-year daily history the volatility model wants.
 *
 * Kept deliberately free of imports so `bars.js` can depend on it without a
 * cycle, and so every function here is testable against a fixture with no
 * network. `fetchYahooSeries()` takes an injectable fetcher for that reason.
 */

export const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

/* What to ask for per timeframe.
 *
 * The ranges are chosen so the answer always contains a *complete* prior session
 * plus enough daily history to be useful:
 *   5Min   five sessions  -> the previous session, and the two before it
 *   15Min  a month        -> ~21 sessions, same reasoning with fewer round trips
 *   1Day   five years     -> 1,255 daily bars; the volatility tab wants 900
 */
export const YAHOO_PLAN = {
  "1Day": { interval: "1d", range: "2y" },
  "5Min": { interval: "5m", range: "5d" },
  "15Min": { interval: "15m", range: "1mo" },
};

/* The daily history that rides along with an intraday request. Two years is
 * ~500 bars: comfortably past the ~120 the volatility model needs, and a quarter
 * of the payload that a five-year range costs. */
const DAILY_RANGE = "2y";

/* The range used when a caller only needs *a few* closes per symbol, which is
 * the watchlist and the relative-strength request. This is not a nicety: a
 * Worker on the free plan has 10 ms of CPU per request, and `/api/bars?symbols=`
 * parses one payload per symbol, so five lookups against a five-year range
 * measured at 341 KB each blew straight through it (Cloudflare error 1102).
 * Three months is ~63 bars - enough for a quote, the 21-EMA alignment and the
 * relative-strength window, and ~30 KB. */
const LIGHT_DAILY_RANGE = "3mo";

/** How many sessions of intraday bars the desk is handed. Mirrors bars.js. */
const INTRADAY_SESSIONS = 3;

/** Below this many bars, a group of prints is not a session. Mirrors bars.js. */
const MIN_SESSION_BARS = 20;

/** How much daily history to keep, mirroring bars.js. */
const MAX_DAILY_BARS = 900;

/** Bars that carry no information: Yahoo closes each range with a zero-volume
 *  single-price stub stamped at the closing bell, which would otherwise show up
 *  as a flat bar. */
function degenerate(r) {
  return !Number.isFinite(r.c) || (r.v === 0 && r.h === r.l && r.o === r.c);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* --------------------------------------------------------------- symbols -- */

/**
 * Yahoo takes the bare ticker, upper-case, with class shares as dashes
 * (BRK.B -> BRK-B). Validated before it can reach a URL so a crafted symbol
 * cannot turn the request into something else.
 */
export function yahooSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.^-]{0,11}$/.test(raw)) return null;
  return raw.replace(/\./g, "-").toUpperCase();
}

export function chartUrl(sym, interval, range) {
  return `${YAHOO_BASE}${encodeURIComponent(sym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
}

/* ------------------------------------------------------------ time helpers -- */

function partsInZone(ms, zone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const out = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const naiveUtc = (p) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/** Wall-clock parts in `zone` -> the UTC instant they name (DST-correct). */
export function wallToUtc(zone, year, month, day, minutes) {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let ms = naive - (naiveUtc(partsInZone(naive, zone)) - naive);
  ms = naive - (naiveUtc(partsInZone(ms, zone)) - ms);
  return ms;
}

/** `YYYY-MM-DD` on the US/Eastern clock, plus minute-of-day. */
export function etParts(ms) {
  const p = partsInZone(ms, "America/New_York");
  return {
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    minutes: p.hour * 60 + p.minute,
  };
}

const RTH_OPEN_MIN = 9 * 60 + 30;
const RTH_CLOSE_MIN = 16 * 60;

/* ---------------------------------------------------------------- parsing -- */

/**
 * Yahoo's chart payload -> `{ meta, rows }` with rows as plain OHLCV.
 *
 * Throws a short human message for every way the endpoint says no, so the route
 * can turn it into a sentence rather than a stack trace. `Not Found` is the one
 * that means "bad ticker", and the wording is kept in step with the route's own
 * unknown-symbol mapping.
 */
export function parseChart(payload) {
  let j = payload;
  if (typeof payload === "string") {
    try {
      j = JSON.parse(payload);
    } catch {
      throw new Error("Yahoo returned a response that was not JSON.");
    }
  }
  const chart = j && j.chart;
  if (!chart) throw new Error("Yahoo returned an unexpected payload.");
  if (chart.error) {
    const { code, description } = chart.error;
    if (/not found/i.test(code || "") || /no data found/i.test(description || "")) {
      throw new Error("No data for that symbol.");
    }
    throw new Error(`Yahoo error: ${code || description || "unknown"}`);
  }
  const r = chart.result && chart.result[0];
  if (!r) throw new Error("Yahoo returned no result for that symbol.");

  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const ts = r.timestamp || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close ? q.close[i] : null;
    const row = {
      ms: ts[i] * 1000,
      o: q.open ? q.open[i] : null,
      h: q.high ? q.high[i] : null,
      l: q.low ? q.low[i] : null,
      c,
      v: q.volume ? q.volume[i] : 0,
    };
    if (row.o == null || row.h == null || row.l == null || row.c == null) continue;
    if (degenerate(row)) continue;
    rows.push({
      ms: row.ms,
      o: Number(row.o),
      h: Number(row.h),
      l: Number(row.l),
      c: Number(row.c),
      v: Number.isFinite(row.v) ? Number(row.v) : 0,
    });
  }
  rows.sort((a, b) => a.ms - b.ms);
  return { meta: r.meta || {}, rows };
}

/** Daily rows -> bars stamped at that session's 09:30 ET, the desk's convention. */
export function dailyFromRows(rows) {
  const byDate = new Map();
  for (const r of rows) {
    byDate.set(etParts(r.ms).date, r);
  }
  const bars = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, r]) => {
      const [y, m, d] = date.split("-").map(Number);
      return { t: new Date(wallToUtc("America/New_York", y, m, d, RTH_OPEN_MIN)).toISOString(), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
    });
  return bars.length > MAX_DAILY_BARS ? bars.slice(-MAX_DAILY_BARS) : bars;
}

/**
 * Intraday rows -> the last few completed ET sessions.
 *
 * "Completed" is answered from the payload, not guessed: Yahoo reports when the
 * current regular session ends in `meta.currentTradingPeriod.regular.end`. While
 * that instant is still in the future the newest session is partial and is
 * dropped, which also makes a half-day correct - the field carries the real
 * early close, so a session that finished at 13:00 counts as complete at 13:01.
 */
export function intradaySessions(rows, meta, nowMs) {
  const byDate = new Map();
  for (const r of rows) {
    const p = etParts(r.ms);
    // Regular hours only, the same window the CSV path enforces.
    if (p.minutes < RTH_OPEN_MIN || p.minutes >= RTH_CLOSE_MIN) continue;
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date).push({ ms: r.ms, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
  let list = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  /* Drop the session that is still running, and only that one.
   *
   * Yahoo states when the current regular session ends, so this is answered from
   * the payload rather than inferred. That matters on a half day: the field
   * carries the real early close, so a 13:00 finish counts as complete at 13:01
   * instead of being mistaken for a partial session all afternoon. (The CSV path
   * cannot know this and falls back to "80% of the busiest day", which quietly
   * drops every half day.) */
  const end = meta && meta.currentTradingPeriod && meta.currentTradingPeriod.regular && meta.currentTradingPeriod.regular.end;
  const endMs = Number.isFinite(end) ? end * 1000 : null;
  if (endMs != null && nowMs < endMs) {
    const today = etParts(nowMs).date;
    const trimmed = list.filter(([d]) => d !== today);
    if (trimmed.length) list = trimmed; // but never drop the only session we have
  }
  // Anything thinner than this is not a session, whatever the calendar says.
  list = list.filter(([, bars]) => bars.length >= MIN_SESSION_BARS);
  if (!list.length) throw new Error("Yahoo returned intraday bars, but none formed a US session.");

  // Every chosen session is handed over, concatenated and in time order - not
  // just the newest. The desk reads prior-day levels and the 21-EMA alignment
  // off these bars, and both need more than one session to say anything.
  const chosen = list.slice(-INTRADAY_SESSIONS);
  const bars = chosen
    .flatMap(([, b]) => b)
    .sort((a, b) => a.ms - b.ms)
    .map((b) => ({ t: new Date(b.ms).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  return { bars, date: chosen[chosen.length - 1][0], dates: chosen.map(([d]) => d) };
}

/* ------------------------------------------------------------------ fetch -- */

async function getChart(sym, interval, range, fetcher) {
  const res = await fetcher(chartUrl(sym, interval, range), {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (res.status === 404) throw new Error("No data for that symbol.");
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}.`);
  return parseChart(await res.text());
}

/**
 * The desk's payload, assembled from Yahoo.
 *
 * Same shape as the Stooq path in bars.js, including `source`, so nothing
 * downstream (the route, freesrc.js, the tests) has to know which one ran.
 */
export async function fetchYahooSeries({ symbol, tf = "1Day", fetcher = fetch, now = Date.now, light = false } = {}) {
  const sym = yahooSymbol(symbol);
  if (!sym) throw new Error("Not a recognisable ticker symbol.");
  const plan = YAHOO_PLAN[tf];
  if (!plan) throw new Error(`Unsupported timeframe: ${tf}`);
  const dayRange = light ? LIGHT_DAILY_RANGE : DAILY_RANGE;

  const intraday = tf !== "1Day";
  // The daily series is wanted either way: prior-day levels, relative strength
  // and the volatility model all read from it. Two independent requests, so
  // they go out together.
  const [primary, dailyChart] = intraday
    ? await Promise.all([
        getChart(sym, plan.interval, plan.range, fetcher),
        getChart(sym, "1d", dayRange, fetcher),
      ])
    : [await getChart(sym, "1d", dayRange, fetcher), null];

  const daily = dailyFromRows((dailyChart || primary).rows);
  const asOf = daily.length ? etParts(Date.parse(daily[daily.length - 1].t)).date : null;
  const upper = String(symbol).toUpperCase();

  if (!intraday) {
    return {
      symbol: upper,
      tf,
      source: "yahoo",
      delayed: true,
      tz: null,
      sessionDate: asOf,
      asOf,
      bars: daily,
      daily,
      note: "Daily bars, delayed end-of-day data.",
    };
  }

  const session = intradaySessions(primary.rows, primary.meta, now());
  return {
    symbol: upper,
    tf,
    source: "yahoo",
    delayed: true,
    tz: (primary.meta && primary.meta.exchangeTimezoneName) || "America/New_York",
    tzCoverage: 1,
    sessionDate: session.date,
    sessions: session.dates.length,
    asOf,
    bars: session.bars,
    daily,
    note: `${session.dates.length} session(s) of ${tf === "15Min" ? "15-minute" : "5-minute"} bars; the most recent completed session is replayed, delayed end-of-day data.`,
  };
}
