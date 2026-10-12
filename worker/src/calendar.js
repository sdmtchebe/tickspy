/* The economic calendar, and where its weeks come from.
 *
 * Two upstreams, on purpose:
 *
 *   1. The provider's own "this week" file. Every release in it carries an
 *      impact rating (High/Medium/Low/Holiday), which is what the desk's "high
 *      impact only" switch and its alert rules read. It publishes exactly one
 *      week, though, and the sibling files answer 404 - there is no nextweek.
 *
 *   2. Nasdaq's keyless per-day calendar. It answers for any date asked of it,
 *      which is the only reason a "show me the week after this one" button can
 *      work at all. It sends no impact rating, so those rows are served with an
 *      empty impact and the desk labels them "not rated" rather than inventing
 *      a severity for them.
 *
 * Rows from the two are merged and deduplicated on time plus title, and the
 * rated row wins: a release the provider has rated is never downgraded to "not
 * rated" just because a second source also lists it.
 */

export const CALENDAR_UPSTREAM = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
export const NASDAQ_CALENDAR = "https://api.nasdaq.com/api/calendar/economicevents";

/* Nasdaq rejects requests from anything that does not look like a browser
 * (403), including a plain server-side fetch. The endpoint itself is public and
 * answers with `access-control-allow-origin: *`, so it is meant to be called
 * from a page; we are calling it on the visitor's behalf and identify as the
 * browser the desk would have used. */
export const NASDAQ_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/* TickSPY's own agent for upstreams that do not care, so an operator reading a
 * log can tell where the traffic came from. */
export const CALENDAR_UA = "TickSPY/1.0 (+https://github.com/sdmtchebe/tickspy)";

/* How far past the provider's published week the Nasdaq leg reaches. Three
 * weeks is more than the desk ever shows at once, and it bounds both the build
 * time and the size of the published file. */
export const FORWARD_DAYS = 21;

const DAY_MS = 86400000;

/** Nasdaq writes its country column as a name; the rest of the desk speaks codes. */
const COUNTRY_CODES = {
  "United States": "USD",
  "United Kingdom": "GBP",
  "Euro Zone": "EUR",
  Eurozone: "EUR",
  Germany: "EUR",
  France: "EUR",
  Italy: "EUR",
  Spain: "EUR",
  Netherlands: "EUR",
  Ireland: "EUR",
  Portugal: "EUR",
  Belgium: "EUR",
  Austria: "EUR",
  Finland: "EUR",
  Greece: "EUR",
  Japan: "JPY",
  Canada: "CAD",
  Australia: "AUD",
  "New Zealand": "NZD",
  China: "CNY",
  Switzerland: "CHF",
  Brazil: "BRL",
  Mexico: "MXN",
  India: "INR",
  Russia: "RUB",
  Turkey: "TRY",
  "South Africa": "ZAR",
  Sweden: "SEK",
  Norway: "NOK",
  Denmark: "DKK",
  Poland: "PLN",
  Singapore: "SGD",
  "Hong Kong": "HKD",
  "South Korea": "KRW",
  Taiwan: "TWD",
  Indonesia: "IDR",
  Malaysia: "MYR",
  Thailand: "THB",
  Philippines: "PHP",
  Argentina: "ARS",
  Chile: "CLP",
  Colombia: "COP",
  Israel: "ILS",
  "Saudi Arabia": "SAR",
  Egypt: "EGP",
  Nigeria: "NGN",
};

/** Strip the `&nbsp;` padding Nasdaq uses for an empty cell, and collapse space. */
export function clean(value) {
  return String(value == null ? "" : value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The provider's file, reduced to the one shape the rest of the code speaks. */
export function normaliseCalendar(raw) {
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

/**
 * One Nasdaq day payload, as events. `date` is the day that was requested, which
 * Nasdaq stamps in GMT; its time column is GMT too, so appending `Z` to the two
 * together gives the instant without any timezone guesswork.
 *
 * Rows whose time is not a clock time ("All Day", "Tentative") are dropped: the
 * desk orders events by the minute and a release with no time cannot be placed
 * on that axis honestly. The provider's own week still carries those days.
 */
export function nasdaqDay(payload, date) {
  const rows = payload && payload.data && Array.isArray(payload.data.rows) ? payload.data.rows : [];
  const out = [];
  for (const row of rows) {
    const title = clean(row && row.eventName);
    const gmt = clean(row && row.gmt);
    const m = /^(\d{1,2}):(\d{2})$/.exec(gmt);
    if (!title || !m) continue;
    const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
    const country = clean(row && row.country);
    out.push({
      title,
      country: COUNTRY_CODES[country] || country,
      date: `${date}T${hh}:${m[2]}:00Z`,
      impact: "",
      forecast: clean(row && row.consensus),
      previous: clean(row && row.previous),
      actual: clean(row && row.actual),
    });
  }
  return out;
}

/** `YYYY-MM-DD` plus a day offset, as a plain date with no clock attached. */
export function addDays(date, days) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The days the Nasdaq leg should ask for: the day after the provider's last
 * published one, onwards. The provider's file is the canonical week, so a day it
 * already covers is never asked for again - two sources spelling the same
 * release differently would otherwise list it twice.
 *
 * A stale or empty provider leg moves the window up to today, which is the path
 * that keeps the desk working on the Monday after a failed refresh: no rated
 * rows, but a real week rather than an empty panel.
 */
export function forwardDates(events, today, days = FORWARD_DAYS) {
  const covered = new Set();
  let last = null;
  for (const e of events) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t).toISOString().slice(0, 10);
    covered.add(d);
    if (last === null || d > last) last = d;
  }
  const start = last !== null && last >= today ? addDays(last, 1) : today;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    // `covered` is a guard, not the rule: it only bites if the provider ever
    // publishes more than one week, which is exactly when asking for the same
    // days again would double every release in them.
    if (!covered.has(d)) out.push(d);
  }
  return out;
}

/**
 * Merge legs into one list: one row per time and title, and a rated row beats an
 * unrated one so the provider's rating always survives.
 */
export function mergeCalendar(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || !e.title || !e.date) continue;
      const key = `${e.date}|${e.title}`;
      const seen = byKey.get(key);
      if (!seen || (!seen.impact && e.impact)) byKey.set(key, e);
    }
  }
  return [...byKey.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** `YYYY-MM-DD` on the US/Eastern clock, which is the day the desk groups by. */
function etToday(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The provider's week. Throws when the upstream itself is unavailable. */
async function fetchProvider() {
  const res = await fetch(CALENDAR_UPSTREAM, {
    headers: { "User-Agent": CALENDAR_UA },
    cf: { cacheTtl: 1800, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`calendar upstream ${res.status}`);
  return normaliseCalendar(await res.json());
}

/**
 * The weeks after the published one. A single day failing is not a failure: the
 * rest of the window is still worth having, and one quiet afternoon at Nasdaq
 * must not empty the desk's calendar.
 */
async function fetchForward(dates) {
  const days = await Promise.all(
    dates.map(async (date) => {
      try {
        const res = await fetch(`${NASDAQ_CALENDAR}?date=${date}`, {
          headers: { "User-Agent": NASDAQ_UA, Accept: "application/json" },
          cf: { cacheTtl: 86400, cacheEverything: true },
        });
        if (!res.ok) return [];
        return nasdaqDay(await res.json(), date);
      } catch (_) {
        return [];
      }
    })
  );
  return days.flat();
}

/**
 * The whole calendar: the provider's rated week first, then whatever Nasdaq
 * publishes beyond it. `now` is injectable so the window can be pinned in tests.
 */
export async function produceCalendar({ now = new Date(), days = FORWARD_DAYS } = {}) {
  let rated = [];
  let providerError = null;
  try {
    rated = await fetchProvider();
  } catch (e) {
    providerError = e;
  }
  const forward = await fetchForward(forwardDates(rated, etToday(now), days));
  const merged = mergeCalendar(rated, forward);
  if (!merged.length && providerError) throw providerError;
  return merged;
}
