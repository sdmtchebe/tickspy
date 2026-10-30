/* internals.js — the state and constants the tests need, kept out of the entry
 * module.
 *
 * WHY THIS FILE EXISTS. A Worker's entry module may only export functions and
 * ExportedHandler objects: workerd validates the module's export map at startup
 * and refuses to boot with
 *
 *     Uncaught TypeError: Incorrect type for map entry 'X':
 *     the provided value is not of type 'function or ExportedHandler'
 *
 * So a `export const SOME_CRON = "..."` in src/index.js is not a style question —
 * it is a Worker that will not start. Node's test runner never notices, because
 * ESM in Node happily exports anything, which is exactly how this class of bug
 * reaches production. Keeping the constants and the shared mutable state here,
 * imported by index.js and by the tests, satisfies both: the runtime sees only
 * functions on the entry module, and the tests still drive the real objects.
 *
 * Everything in this file is shared per isolate. There is one copy per Worker
 * instance, and index.js holds that same copy — the tests reset it between cases,
 * which is why it is exported at all.
 */

import { createMemory } from "./cache.js";

/** Per-isolate cache, survives between requests handled by the same instance. */
export const _memory = createMemory();

/* ---------------------------------------------------------------- crons ---- */

/** The daily cron. Anything else on the schedule leaves price bars alone. */
export const BARS_CRON = "17 5 * * *";

/* The phone-alert cron.
 *
 * Five minutes is the shortest interval that is honest about what the free tier
 * can do. Every tick costs one Worker invocation and a handful of KV reads, and
 * this one runs 288 times a day, which is nothing against the 100,000-request
 * budget — but it is the reason the UI says "within about five minutes" instead
 * of promising an instant buzz. A minute-by-minute cron would spend 1,440
 * invocations to shave four minutes off a notification nobody acts on in four
 * minutes. */
export const ALERTS_CRON = "*/5 * * * *";

/* ------------------------------------------------------------ price keys --- */

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
export const barsKey = (tf, symbol, light = false) =>
  `${BARS_KEY_PREFIX}${light ? "l" : ""}:${tf}:${String(symbol).toUpperCase()}`;

/* --------------------------------------------------------- fetch budget --- */

/* The free feed publishes a low daily request quota, and /api/bars is the one
 * endpoint that takes a caller-supplied symbol. Without a limit, a script could
 * walk through ticker after ticker and spend that quota on symbols no visitor
 * asked for, leaving the desk's own list unserved. A per-isolate token bucket
 * bounds it: at most BARS_FETCH_BUDGET missing entries may start an upstream
 * fetch per window. Past that the endpoint answers with a sentence instead of
 * calling upstream again. It is a speed bump rather than a wall — Cloudflare runs
 * many isolates — but together with the durable cache holding only DESK_SYMBOLS
 * it keeps the quota pointed at symbols people actually look at. Cached and stale
 * entries are untouched, so ordinary traffic never sees it. */
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
