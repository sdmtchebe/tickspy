/* bars.js — keyless "previous session" price data for the desk.
 *
 * Why this exists
 * ---------------
 * The desk used to be unusable until a visitor created an Alpaca account: the
 * very first thing `load()` did was bounce them to Settings. The request here is
 * the opposite - open the desk and see the previous session straight away,
 * with no account, no key and no cost.
 *
 * Three hard constraints shape the design:
 *
 *   1. No free price source sends CORS headers, so a static page cannot call one
 *      directly. The fetch has to happen here, on the Worker, exactly like the
 *      news feeds and the economic calendar. The browser only ever sees our own
 *      JSON.
 *   2. It has to be legal. Serving one account's market data to every visitor
 *      (a shared Alpaca key, say) is redistribution, which this project's own
 *      terms and `desk/server.py` explicitly refuse to do. So the source here is
 *      keyless and public: Stooq's CSV download, whose terms say the data is
 *      "intended solely for personal use" - the same non-commercial, one-person
 *      -one-copy posture the desk already declares.
 *   3. It has to be useful. The desk is an intraday tool: VWAP, opening ranges,
 *      a session clock, volume-at-price. Daily bars alone would gut it. Stooq
 *      publishes 5-minute history as well as daily, so the previous *session*
 *      can be replayed bar by bar.
 *
 * The awkward part is time. Stooq stamps its CSV in its own local clock
 * (CET/CEST), and the desk is written entirely against US/Eastern. Rather than
 * hard-code an offset, `detectZone()` scores the plausible zones against the one
 * thing that is certain about a US equity session - it occupies 09:30-16:00 ET -
 * and picks the interpretation that puts the bars in the session. The operator
 * can override it with a Worker var if Stooq ever changes.
 *
 * Nothing here throws for an expected upstream condition; it throws an Error
 * with a short, human message and the route turns that into a 502. Every
 * function is pure except `fetchSeries()`, which takes an injectable fetcher, so
 * the whole thing is testable with no network.
 */

import { fetchYahooSeries } from "./yahoo.js";

export const STOOQ_BASE = "https://stooq.com/q/d/l/";

/* The CSV source can take ~40 s to time out when it refuses a network, which is
   now the normal case. It only ever runs as the fallback, so it gets a short
   leash: a fallback that hangs is worse than no fallback. */
const STOOQ_TIMEOUT_MS = 6000;

/** Stooq stamps intraday CSV with its own market clock. Overridable. */
export const DEFAULT_STOOQ_ZONE = "Europe/Warsaw";

/** Bars must land inside this US/Eastern window to count as the session. */
export const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
export const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

/** A replay needs a real session, not a handful of stray prints. */
const MIN_SESSION_BARS = 20;

/* How many sessions of intraday bars to hand the desk.
 *
 * One is not enough. The desk's indicators need 40+ bars to say anything, a
 * 15-minute session is only 26, and prior-day levels need the day before the
 * one being replayed. Three sessions covers all three, and it is what makes the
 * free view behave like the live one instead of degrading as the replay starts. */
const INTRADAY_SESSIONS = 3;

/** How much daily history to hand the desk (prior-day levels, RS, the vol model). */
const MAX_DAILY_BARS = 900;

/** Zones worth testing. Order only matters for ties. */
export const ZONE_CANDIDATES = [
  "America/New_York",
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Berlin",
  "UTC",
  "America/Chicago",
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ------------------------------------------------------------------ symbols -- */

/**
 * Stooq names US listings `<ticker>.us`, lower-case, with dots as dashes
 * (BRK.B -> brk-b.us). Rejects anything that could not be a ticker, so a
 * crafted symbol can never turn the upstream URL into something else.
 */
export function stooqSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.^-]{0,11}$/.test(raw)) return null;
  const body = raw.replace(/\.(us|usa)$/i, "").toLowerCase().replace(/\./g, "-");
  return `${body}.us`;
}

/** True for the timeframes the desk can offer without a key. Hourly is
 *  deliberately absent: a session holds too few hourly bars to clear the
 *  session check below, so offering it would be offering a broken view. */
export function knownInterval(tf) {
  return tf === "1Day" || tf === "5Min" || tf === "15Min";
}

/* ------------------------------------------------------------- time helpers -- */

function partsInZone(ms, zone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out = {};
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const naiveUtc = (p) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

/** Wall-clock parts in `zone` -> the UTC instant they name. */
export function wallToUtc(zone, year, month, day, minutes, second = 0) {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, second);
  // Two passes: the first guess can land on the wrong side of a DST change.
  let ms = naive - (naiveUtc(partsInZone(naive, zone)) - naive);
  ms = naive - (naiveUtc(partsInZone(ms, zone)) - ms);
  return ms;
}

/** `YYYY-MM-DD` and minute-of-day on the US/Eastern clock. */
export function etParts(ms) {
  const p = partsInZone(ms, "America/New_York");
  return {
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    minutes: p.hour * 60 + p.minute,
  };
}

/* --------------------------------------------------------------- CSV input -- */

/**
 * Stooq answers with `Date,Open,High,Low,Close,Volume` and one row per bar; the
 * Date column carries a time for intraday series. Also detects the two ways this
 * endpoint says "no": a quota banner, and an anti-bot HTML page. Both would
 * otherwise look like a CSV with one unparseable row, and silently produce an
 * empty series the desk would show as "no data".
 */
export function parseCsv(text) {
  const body = String(text == null ? "" : text).trim();
  if (!body) throw new Error("Stooq returned an empty response.");
  if (/^\s*</.test(body)) throw new Error("Stooq returned an HTML page instead of CSV (anti-bot challenge).");
  if (/exceeded|daily hits limit|quota/i.test(body)) throw new Error("Stooq reported its daily request quota was exceeded.");

  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("Stooq returned no rows.");
  const first = lines[0].toLowerCase();
  if (first.startsWith("date,") || first.startsWith("data,")) lines.shift(); // header
  if (!lines.length) throw new Error("Stooq returned a header with no rows.");

  const rows = [];
  for (const line of lines) {
    const c = line.split(",").map((s) => s.trim());
    if (c.length < 5) continue;
    const [datePart, timePart] = c[0].split(/[ T]/);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart || "")) continue;
    const [y, m, d] = datePart.split("-").map(Number);
    let minutes = 0;
    if (timePart) {
      const t = timePart.split(":").map(Number);
      if (!Number.isFinite(t[0])) continue;
      minutes = t[0] * 60 + (t[1] || 0);
    }
    const o = Number(c[1]);
    const h = Number(c[2]);
    const l = Number(c[3]);
    const cl = Number(c[4]);
    const v = c[5] === undefined || c[5] === "" ? 0 : Number(c[5]);
    if (![o, h, l, cl].every((x) => Number.isFinite(x))) continue;
    rows.push({ y, m, d, minutes, raw_date: datePart, o, h, l, c: cl, v: Number.isFinite(v) ? v : 0 });
  }
  if (!rows.length) throw new Error("Stooq returned rows, but none of them were parseable OHLC.");
  rows.sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d || a.minutes - b.minutes);
  return rows;
}

/* ------------------------------------------------------------ zone finder -- */

/**
 * Which clock is this CSV written in?
 *
 * The one fact we can rely on is the shape of a US equity session: whatever zone
 * the stamps are in, re-reading them as ET must put the bulk of the bars inside
 * 09:30-16:00. A Warsaw-stamped RTH file read as Warsaw gives ~100% coverage and
 * read as New York gives ~0%; an already-ET file does the opposite. Returns the
 * best candidate plus its coverage, so a caller can tell "confident" from
 * "nothing fits".
 */
export function detectZone(rows) {
  const intraday = rows.filter((r) => r.minutes !== 0);
  const sample = intraday.length ? intraday : rows;
  let best = { zone: null, coverage: 0 };
  for (const zone of ZONE_CANDIDATES) {
    let inside = 0;
    for (const r of sample) {
      const et = etParts(wallToUtc(zone, r.y, r.m, r.d, r.minutes));
      if (et.minutes >= RTH_OPEN_MIN && et.minutes < RTH_CLOSE_MIN) inside++;
    }
    const coverage = inside / sample.length;
    if (coverage > best.coverage) best = { zone, coverage };
  }
  return best;
}

/* --------------------------------------------------------------- series -- */

/** Daily rows -> bars stamped at that session's 09:30 ET. */
export function dailySeries(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const date = `${r.y}-${String(r.m).padStart(2, "0")}-${String(r.d).padStart(2, "0")}`;
    byDate.set(date, r); // later rows win, so a duplicate date keeps the latest print
  }
  const bars = [];
  for (const [date, r] of byDate) {
    const [y, m, d] = date.split("-").map(Number);
    bars.push({
      t: new Date(wallToUtc("America/New_York", y, m, d, RTH_OPEN_MIN)).toISOString(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    });
  }
  bars.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return bars.slice(-MAX_DAILY_BARS);
}

/**
 * The most recent *complete* sessions in an intraday series, converted to ET.
 *
 * "Complete" is measured against the busiest day in the file rather than a fixed
 * count, so the same code works for 1-, 5- and 15-minute series, and a partially
 * recorded current session (the upstream is end-of-day, but the file may still
 * be mid-session) is skipped in favour of the last full one.
 *
 * @param {number} count how many of the last qualifying sessions to return
 */
export function intradaySessions(rows, zone = DEFAULT_STOOQ_ZONE, count = 1) {
  const withEt = rows.map((r) => {
    const ms = wallToUtc(zone, r.y, r.m, r.d, r.minutes);
    return { ms, et: etParts(ms), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
  });

  const byDate = new Map();
  for (const b of withEt) {
    if (b.et.minutes < RTH_OPEN_MIN || b.et.minutes >= RTH_CLOSE_MIN) continue;
    if (!byDate.has(b.et.date)) byDate.set(b.et.date, []);
    byDate.get(b.et.date).push(b);
  }
  if (!byDate.size) return { date: null, dates: [], bars: [] };

  const counts = [...byDate.values()].map((v) => v.length);
  const busiest = Math.max(...counts);
  const floor = Math.max(MIN_SESSION_BARS, Math.floor(busiest * 0.8));
  const dates = [...byDate.keys()].filter((d) => byDate.get(d).length >= floor).sort();
  if (!dates.length) return { date: null, dates: [], bars: [] };

  const chosen = dates.slice(-Math.max(1, count));
  const bars = chosen
    .flatMap((d) => byDate.get(d))
    .sort((a, b) => a.ms - b.ms)
    .map((b) => ({ t: new Date(b.ms).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  return { date: chosen[chosen.length - 1], dates: chosen, bars };
}

/** The single most recent complete session. */
export function intradaySession(rows, zone = DEFAULT_STOOQ_ZONE) {
  return intradaySessions(rows, zone, 1);
}

/**
 * Roll bars up to a coarser interval inside each session. Used for the desk's
 * 15-minute view, which Stooq does not serve directly.
 */
export function aggregate(bars, minutes) {
  if (!Number.isFinite(minutes) || minutes <= 1) return bars.slice();
  const bySlot = new Map();
  for (const b of bars) {
    const et = etParts(Date.parse(b.t));
    const slot = et.date + "#" + Math.floor((et.minutes - RTH_OPEN_MIN) / minutes);
    const cur = bySlot.get(slot);
    if (!cur) {
      bySlot.set(slot, { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return [...bySlot.values()];
}

/* ------------------------------------------------------------------ fetch -- */

/** The CSV URL for a symbol and a Stooq interval code ("d", "5", "h"). */
export function seriesUrl(sym, interval, { days = 730, now = Date.now() } = {}) {
  const d2 = new Date(now);
  const d1 = new Date(now - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({ s: sym, i: interval, d1: fmt(d1), d2: fmt(d2) });
  return `${STOOQ_BASE}?${params.toString()}`;
}

async function getCsv(url, fetcher) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), STOOQ_TIMEOUT_MS);
  try {
    // No `cf.cacheEverything` here on purpose. This endpoint answers a blocked
    // network with a 200 carrying an anti-bot HTML page, and cacheEverything
    // would pin that page at Cloudflare's edge for the whole cacheTtl - the
    // table would then keep being told "no data" long after the real reason
    // changed. A payload is only trustworthy once parseCsv has read it, and
    // that happens above the cache, so nothing here may be cached blind.
    const res = await fetcher(url, {
      headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" },
      signal: ctl.signal,
    });
    if (res.status === 404) throw new Error("Stooq has no data for that symbol.");
    if (!res.ok) throw new Error(`Stooq responded ${res.status}.`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Everything the desk needs for one symbol, in one payload.
 *
 * @param {object}  opts
 * @param {string}  opts.symbol    e.g. "SPY"
 * @param {string}  opts.tf        "1Day" | "5Min" | "15Min" | "1Hour"
 * @param {Function} opts.fetcher  injectable for tests
 * @param {string}  opts.zone      force a source clock (Worker var STOOQ_ZONE)
 * @returns {{bars:Array, daily:Array, sessionDate:string|null, tz:string, ...}}
 */
/**
 * The desk's one entry point for price data.
 *
 * Yahoo runs first because it is the only free source that answers a Cloudflare
 * Worker (see yahoo.js for the measurement). Stooq stays as the fallback, for
 * the day Yahoo rate-limits or changes shape, and because it is the source the
 * CSV parser and its fixtures were written for.
 *
 * `source` pins one deliberately, which is what the tests use.
 */
export async function fetchSeries({ symbol, tf = "1Day", fetcher = fetch, now = Date.now, zone = null, source = null, light = false } = {}) {
  if (source === "stooq") return fetchStooqSeries({ symbol, tf, fetcher, now, zone });
  try {
    return await fetchYahooSeries({ symbol, tf, fetcher, now, light });
  } catch (e) {
    if (source === "yahoo") throw e;
    const first = String((e && e.message) || e);
    // A symbol no source has heard of is not a source problem. Retrying it would
    // only add the fallback's timeout to the reply before returning the same
    // answer, so report it straight away.
    if (/no data for that symbol|recognisable ticker/i.test(first)) throw e;
    try {
      return await fetchStooqSeries({ symbol, tf, fetcher, now, zone });
    } catch (e2) {
      throw new Error(`${first} (the Stooq fallback also failed: ${String((e2 && e2.message) || e2)})`);
    }
  }
}

/** The original Stooq CSV reader, kept as the fallback source. */
export async function fetchStooqSeries({ symbol, tf = "1Day", fetcher = fetch, now = Date.now, zone = null } = {}) {
  const sym = stooqSymbol(symbol);
  if (!sym) throw new Error("Not a recognisable ticker symbol.");
  if (!knownInterval(tf)) throw new Error(`Unsupported timeframe: ${tf}`);

  const intraday = tf !== "1Day";
  const rowsFor = (interval, opts) => getCsv(seriesUrl(sym, interval, opts), fetcher).then(parseCsv);

  // An intraday view still needs the daily series: prior-day levels, relative
  // strength and the volatility model all read from it. The two requests are
  // independent, so they go out together.
  let rows;
  let dayRows;
  if (intraday) {
    // allSettled rather than all: if both requests fail, `all` would leave the
    // second rejection unhandled while it throws the first.
    const [a, b] = await Promise.allSettled([rowsFor("5", { now: now() }), rowsFor("d", { now: now() })]);
    if (a.status === "rejected") throw a.reason;
    if (b.status === "rejected") throw b.reason;
    rows = a.value;
    dayRows = b.value;
  } else {
    rows = await rowsFor("d", { now: now() });
    dayRows = rows;
  }

  const daily = dailySeries(dayRows);
  const asOf = daily.length ? etParts(Date.parse(daily[daily.length - 1].t)).date : null;

  if (!intraday) {
    return {
      symbol: String(symbol).toUpperCase(),
      tf,
      source: "stooq",
      delayed: true,
      tz: null,
      sessionDate: asOf,
      asOf,
      bars: daily,
      daily,
      note: "Daily bars, delayed end-of-day data.",
    };
  }

  const detected = zone ? { zone, coverage: 1 } : detectZone(rows);
  const usedZone = detected.zone || DEFAULT_STOOQ_ZONE;
  // Pick the sessions from the 5-minute source bars, then roll the chosen ones
  // up if a coarser view was asked for. `aggregate` buckets by ET date and slot,
  // so rolling up can never merge two sessions into one bar.
  const session = intradaySessions(rows, usedZone, INTRADAY_SESSIONS);
  if (!session.bars.length) {
    throw new Error("Stooq returned intraday rows, but none formed a recognisable US session.");
  }
  const bars = tf === "15Min" ? aggregate(session.bars, 15) : session.bars;

  return {
    symbol: String(symbol).toUpperCase(),
    tf,
    source: "stooq",
    delayed: true,
    tz: usedZone,
    tzCoverage: Math.round(detected.coverage * 1000) / 1000,
    sessionDate: session.date,
    sessions: session.dates.length,
    asOf,
    bars,
    daily,
    note: `${session.dates.length} session(s) of ${tf === "15Min" ? "15-minute" : "5-minute"} bars; the most recent completed session is replayed, delayed end-of-day data.`,
  };
}
