/* alerts.js — Telegram alerts: subscriptions, evaluation, delivery.
 *
 * The desk's own price alerts run on the ticking clock of the page, so they stop
 * when the page does. This is the other half: the rules are handed to this
 * Worker, which re-checks them on a five-minute cron and messages the chat that
 * was linked to them. The chat is identified by its Telegram chat id, which the
 * person proved they control by pressing Start on a one-time code.
 *
 * Design notes, because several of these are the difference between "free" and
 * "free until the first busy day":
 *
 *   · NOTHING PERSONAL BEYOND THE CHAT ID. There is no phone number, email, name
 *     or IP in the record. A chat id is a number Telegram assigns to a
 *     conversation; a link code is what connects one to a set of rules, and it
 *     is deleted the moment it is used. One button deletes the rest.
 *   · Writes happen on link, on a rules change, on unlink, and when an alert
 *     actually fires. Never on a quiet tick. Workers KV allows 1,000 writes a
 *     day on the free plan, so a per-tick write would cap this feature at about
 *     a dozen users; firing-only writes mean the cost follows real alerts.
 *   · Reads are the cheap operation (100,000/day). One list per tick plus one
 *     read per subscription. A tick that finds nothing to do costs almost
 *     nothing and makes no outbound request at all.
 *   · Every rule carries its own re-arm. A price alert that stays true does not
 *     re-notify every five minutes; it goes quiet for the cooldown and then
 *     speaks again only if it crosses afresh.
 *
 * Everything here is importable and testable with a stubbed KV, a stubbed clock
 * and a stubbed fetcher: the tests drive real ticks rather than mocking this
 * module's own logic.
 */

import { alertText, sendTelegram, telegramReady } from "./telegram.js";

/** The default cooldown a fired rule stays quiet for. A subscription may choose
 *  its own between MIN_REARM_MINUTES and MAX_REARM_MINUTES. */
export const REARM_MS = 30 * 60 * 1000;
export const MIN_REARM_MINUTES = 10;
export const MAX_REARM_MINUTES = 240;

/** A headline is "new" for this long. Set just above the tick interval so a
 *  subscriber cannot be told about the same story twice by two adjacent ticks,
 *  and a phone that was offline for a moment still gets it. */
export const NEWS_WINDOW_MS = 30 * 60 * 1000;

/** How many messages one tick may send. Cloudflare gives a free cron invocation
 *  10 ms of CPU; a burst of hundreds of sends would be killed mid-run, so the
 *  tick does a bounded amount of work and the next one continues. Nothing is
 *  dropped: a skipped subscriber keeps its rules. */
export const MAX_SENDS_PER_TICK = 20;

/** Cap on stored subscriptions. The read budget is the real limit, not this. */
export const MAX_SUBSCRIPTIONS = 2000;

/** How long a one-time link code stays good. Long enough to install Telegram
 *  and press Start; short enough that a code found in a screenshot is useless. */
export const LINK_TTL_MS = 15 * 60 * 1000;

/** Bounds the rule editor is built around, exported so the desk and the server
 *  cannot disagree about them. */
export const LIMITS = {
  price: 20,
  newsSymbols: 10,
  words: 10,
  wordLength: 24,
  moveSymbols: 12,
  moveWindow: [1, 120],
  moveThreshold: [0.1, 25],
  pricePercent: [0.1, 50],
  lead: [1, 120],
};

const KEY_PREFIX = "alert:";
const CHAT_PREFIX = "tgchat:";

/** Exported for the API module, which owns the link lifecycle. */
export const LINK_PREFIX = "tglink:";

/* ------------------------------------------------------------------ ids ---- */

/** A subscription id: 16 random bytes, hex. Opaque, unguessable, meaningless. */
export function newId(bytes = crypto.getRandomValues(new Uint8Array(16))) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The secret that authorises changing or deleting one subscription. */
export function newToken() {
  return newId(crypto.getRandomValues(new Uint8Array(24)));
}

/** A one-time code for the Telegram deep link. Same shape as an id. */
export function newLinkCode() {
  return newId();
}

export function linkCodeOk(code) {
  return /^[0-9a-f]{32}$/.test(String(code || ""));
}

/** An id we will accept in a request body. */
export function subscriptionIdOk(id) {
  return /^[0-9a-f]{32}$/.test(String(id || ""));
}

/**
 * Constant-time comparison for the management token.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks how
 * much of a token a caller guessed. The token is a 48-character secret, so it is
 * worth comparing properly.
 */
export function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------- validation -- */

const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9.^-]{0,11}$/;
const PRICE_TYPES = new Set(["above", "below", "pct_up", "pct_down"]);

export function cleanSymbol(s) {
  const raw = String(s || "").trim().toUpperCase();
  return SYMBOL_RE.test(raw) ? raw : null;
}

/** A deduplicated list of valid tickers. */
function symbolList(input, max = LIMITS.newsSymbols) {
  const out = [];
  for (const raw of Array.isArray(input) ? input.slice(0, max * 2) : []) {
    const sym = cleanSymbol(raw);
    if (sym && !out.includes(sym)) out.push(sym);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A deduplicated list of words to match against a headline or an event title.
 *
 * These are plain substring matches on lowercased text, which is the only claim
 * the UI makes. Punctuation is allowed but markup-ish characters are not: the
 * list is shown back in a page and in a chat, and there is no reason for either
 * to have to escape it twice.
 */
function wordList(input, max = LIMITS.words) {
  const out = [];
  for (const raw of Array.isArray(input) ? input.slice(0, max * 2) : []) {
    const word = String(raw || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, LIMITS.wordLength);
    if (!word || !/[\p{L}\p{N}]/u.test(word)) continue;
    if (!/^[\p{L}\p{N}\s&$%.,'’+-]+$/u.test(word)) continue;
    const lower = word.toLowerCase();
    if (out.some((w) => w.toLowerCase() === lower)) continue;
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

const clampNum = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const clampInt = (value, fallback, min, max) => Math.round(clampNum(value, fallback, min, max));

/** `22:00` -> `22:00`; anything else -> the fallback. */
function hhmm(value, fallback) {
  const raw = String(value || "").trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!m) return fallback;
  return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
}

/** An IANA zone name we can actually format with, or UTC. */
function zoneName(value) {
  const raw = String(value || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(raw)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "UTC";
  }
}

/**
 * Normalise a rules object from the desk.
 *
 * Every field is optional and every field is bounded. This runs on input that
 * arrived over the network from a page, so it assumes nothing: unknown keys are
 * dropped, arrays are capped, numbers are clamped, and anything malformed is
 * discarded rather than stored and re-parsed on every tick for the next month.
 *
 * Every section keeps a sane default when it is missing, so a record saved by an
 * older build (price + news + calendar only) still loads and still works.
 */
export function cleanRules(input) {
  const src = input && typeof input === "object" ? input : {};

  // --- price rules ---------------------------------------------------------
  const price = [];
  for (const raw of Array.isArray(src.price) ? src.price.slice(0, LIMITS.price * 2) : []) {
    const sym = cleanSymbol(raw && raw.sym);
    const type = raw && PRICE_TYPES.has(raw.type) ? raw.type : null;
    const isPercent = type === "pct_up" || type === "pct_down";
    const val = isPercent
      ? clampNum(raw && raw.val, NaN, LIMITS.pricePercent[0], LIMITS.pricePercent[1])
      : Number(raw && raw.val);
    if (!sym || !type || !Number.isFinite(val) || val <= 0) continue;
    price.push({ sym, type, val: isPercent ? Math.round(val * 10) / 10 : Math.round(val * 100) / 100 });
    if (price.length >= LIMITS.price) break;
  }

  // --- big moves -----------------------------------------------------------
  const mv = src.moves && typeof src.moves === "object" ? src.moves : {};
  const moves = {
    on: Boolean(mv.on),
    // A "jump" and a "drop" get separate thresholds because the two are not
    // symmetric in practice: a 1% gap up is ordinary, a 1% gap down at the open
    // is the moment most people want the message.
    up: Math.round(clampNum(mv.up, 2, LIMITS.moveThreshold[0], LIMITS.moveThreshold[1]) * 10) / 10,
    down: Math.round(clampNum(mv.down, 2, LIMITS.moveThreshold[0], LIMITS.moveThreshold[1]) * 10) / 10,
    window: clampInt(mv.window, 15, LIMITS.moveWindow[0], LIMITS.moveWindow[1]),
    symbols: symbolList(mv.symbols, LIMITS.moveSymbols),
  };

  // --- news ----------------------------------------------------------------
  const newsSrc = src.news && typeof src.news === "object" ? src.news : {};
  const news = {
    on: Boolean(newsSrc.on),
    symbols: symbolList(newsSrc.symbols),
    keywords: wordList(newsSrc.keywords),
    mute: wordList(newsSrc.mute),
  };

  // --- calendar ------------------------------------------------------------
  const calSrc = src.calendar && typeof src.calendar === "object" ? src.calendar : {};
  const calendar = {
    on: Boolean(calSrc.on),
    impact: calSrc.impact === "HighMedium" || calSrc.impact === "All" ? calSrc.impact : "High",
    lead: clampInt(calSrc.lead, 15, LIMITS.lead[0], LIMITS.lead[1]),
    releases: Boolean(calSrc.releases),
    keywords: wordList(calSrc.keywords),
    mute: wordList(calSrc.mute),
  };

  // --- quiet hours and pacing ---------------------------------------------
  const quietSrc = src.quiet && typeof src.quiet === "object" ? src.quiet : {};
  const quiet = {
    on: Boolean(quietSrc.on),
    from: hhmm(quietSrc.from, "22:00"),
    to: hhmm(quietSrc.to, "07:00"),
    // The browser sends its own zone when it saves. A missing or unknown zone is
    // UTC, which is stated in the UI rather than guessed at.
    tz: zoneName(quietSrc.tz),
  };

  const rearm = clampInt(src.rearm, 30, MIN_REARM_MINUTES, MAX_REARM_MINUTES);

  return { price, moves, news, calendar, quiet, rearm, paused: Boolean(src.paused) };
}

/** True when the rules ask for nothing at all. */
export function rulesAreEmpty(rules) {
  return !rules.price.length && !rules.moves.on && !rules.news.on && !rules.calendar.on;
}

/** Convenience for every evaluator: the cooldown in milliseconds. */
export function rearmMs(rules) {
  return clampInt(rules && rules.rearm, 30, MIN_REARM_MINUTES, MAX_REARM_MINUTES) * 60 * 1000;
}

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "--");

/**
 * The rules as plain sentences, for the chat and for the desk.
 *
 * This is the one description both surfaces use, so /rules in Telegram cannot
 * disagree with the list on the page: it is literally the same function.
 */
export function rulesSummary(rules) {
  const out = [];
  if (rules.paused) out.push("Paused — nothing will be sent");

  for (const r of rules.price) {
    if (r.type === "above" || r.type === "below") {
      out.push(`${r.sym} ${r.type} ${fmt(r.val)}`);
    } else {
      out.push(`${r.sym} ${r.type === "pct_up" ? "up" : "down"} ${r.val}% from the previous close`);
    }
  }

  if (rules.moves.on) {
    const syms = rules.moves.symbols.length ? rules.moves.symbols.join(", ") : "the desk's default symbols";
    out.push(
      `Moves of +${rules.moves.up}% or -${rules.moves.down}% within ${rules.moves.window} min (${syms})`
    );
  }

  if (rules.news.on) {
    const parts = [];
    if (rules.news.symbols.length) parts.push(`mentioning ${rules.news.symbols.join(", ")}`);
    if (rules.news.keywords.length) parts.push(`containing ${rules.news.keywords.join(", ")}`);
    if (!parts.length) parts.push("any market headline");
    if (rules.news.mute.length) parts.push(`never ${rules.news.mute.join(", ")}`);
    out.push(`Headlines ${parts.join("; ")}`);
  }

  if (rules.calendar.on) {
    const which =
      rules.calendar.impact === "High" ? "High-impact" : rules.calendar.impact === "All" ? "All" : "High and medium-impact";
    const parts = [`${which} events`, `${rules.calendar.lead} min before`];
    if (rules.calendar.releases) parts.push("and on release");
    if (rules.calendar.keywords.length) parts.push(`titled ${rules.calendar.keywords.join(", ")}`);
    if (rules.calendar.mute.length) parts.push(`never ${rules.calendar.mute.join(", ")}`);
    out.push(parts.join(" · "));
  }

  if (rules.quiet.on) out.push(`Quiet hours ${rules.quiet.from}–${rules.quiet.to} (${rules.quiet.tz})`);
  out.push(`Cooldown ${rules.rearm} min`);
  return out;
}

/* --------------------------------------------------------------- storage -- */

const key = (id) => `${KEY_PREFIX}${id}`;
const chatKey = (chatId) => `${CHAT_PREFIX}${chatId}`;

/**
 * Save one subscription.
 *
 * The record is small on purpose: the chat id, the rules, and the bookkeeping
 * needed to avoid duplicate messages. No IP, no user agent, no referrer, no
 * timestamp of any page view.
 */
export async function putSubscription(kv, record) {
  await kv.put(key(record.id), JSON.stringify(record));
}

/** Which subscription (if any) belongs to a chat. One chat, one record. */
export async function putChatLink(kv, record) {
  if (!record.chatId) return;
  await kv.put(chatKey(record.chatId), record.id);
}

export async function subscriptionIdForChat(kv, chatId) {
  const id = await kv.get(chatKey(chatId));
  return subscriptionIdOk(id) ? String(id) : null;
}

export async function getSubscription(kv, id) {
  const raw = await kv.get(key(id), "json");
  return raw && typeof raw === "object" ? raw : null;
}

/** Delete a subscription and the index entry that points at it. */
export async function deleteSubscription(kv, id) {
  const rec = await getSubscription(kv, id);
  await kv.delete(key(id));
  if (rec && rec.chatId) await kv.delete(chatKey(rec.chatId));
}

/** Every stored subscription. `list` pages at 1,000 keys, which is why the
 *  stored cap is 2,000: two pages cover the whole store. */
export async function listSubscriptions(kv, limit = MAX_SUBSCRIPTIONS) {
  const out = [];
  let cursor = undefined;
  do {
    const page = await kv.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
    for (const k of page.keys) {
      if (out.length >= limit) return out;
      const rec = await getSubscription(kv, k.name.slice(KEY_PREFIX.length));
      if (rec) out.push(rec);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/* ------------------------------------------------------- link lifecycle --- */

/**
 * Remember a code for 15 minutes, and nothing else.
 *
 * The record starts as `{ at }` and becomes `{ at, id, token }` once the bot has
 * consumed it, so the desk's poll can pick up the credentials it needs to
 * manage the subscription. Keeping the consumed record for the rest of its TTL is
 * what makes a retried poll work after a flaky connection.
 */
export async function putLink(kv, code, value) {
  await kv.put(`${LINK_PREFIX}${code}`, JSON.stringify(value), {
    expirationTtl: Math.ceil(LINK_TTL_MS / 1000),
  });
}

export async function getLink(kv, code) {
  const raw = await kv.get(`${LINK_PREFIX}${code}`, "json");
  return raw && typeof raw === "object" ? raw : null;
}

/* ------------------------------------------------------------ local time --- */

/** Minutes since midnight in the given zone, or null when the zone is unusable. */
export function minutesInZone(zone, now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(now));
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return (h % 24) * 60 + m;
  } catch {
    return null;
  }
}

const clockMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
};

/**
 * Are we inside the subscriber's quiet hours right now?
 *
 * A window that wraps midnight is the normal case (22:00 to 07:00), so the test
 * is not `from <= t <= to` but two ranges. Equal ends mean "no quiet window"
 * rather than "all day": a person who types the same time twice should get
 * alerts, not silence.
 */
export function quietNow(quiet, now = Date.now()) {
  if (!quiet || !quiet.on) return false;
  const cur = minutesInZone(quiet.tz, now);
  if (cur === null) return false;
  const from = clockMinutes(quiet.from);
  const to = clockMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/* ------------------------------------------------------------ evaluation -- */

const sym = (s) => String(s || "").toUpperCase();

/** A quote may be a plain number (older callers, tests) or a quote object. */
function quotePrice(q) {
  if (typeof q === "number") return q;
  return q && Number.isFinite(Number(q.price)) ? Number(q.price) : NaN;
}

/** The close before the current session, when the provider gave it. */
function previousClose(q) {
  if (!q || typeof q !== "object") return NaN;
  const n = Number(q.prevClose);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

const stillQuiet = (last, now, cooldown) => Number.isFinite(Number(last)) && now - Number(last) < cooldown;

/**
 * Price rules that should fire for the quotes given.
 *
 * `above` / `below` compare the last price with a level. `pct_up` / `pct_down`
 * compare it with the previous session's close, which is the number a person
 * means by "SPY is up 2% today" — a rule that says 2% is not affected by where
 * the level happened to be when the rule was made.
 */
export function duePriceAlerts(rules, quotes, fired = {}, now = Date.now(), cooldown = REARM_MS) {
  const due = [];
  for (const r of rules) {
    const q = quotes[sym(r.sym)];
    const p = quotePrice(q);
    if (!Number.isFinite(p)) continue;
    const k = `price:${sym(r.sym)}:${r.type}:${r.val}`;
    if (stillQuiet(fired[k], now, cooldown)) continue;

    if (r.type === "pct_up" || r.type === "pct_down") {
      const prev = previousClose(q);
      if (!Number.isFinite(prev)) continue;
      const pct = (p / prev - 1) * 100;
      const hit = r.type === "pct_up" ? pct >= r.val : pct <= -r.val;
      if (hit) due.push({ ...r, key: k, price: p, prevClose: prev, pct });
      continue;
    }

    const hit = r.type === "above" ? p >= r.val : p <= r.val;
    if (hit) due.push({ ...r, key: k, price: p });
  }
  return due;
}

/**
 * The closest price at or before `at` in an intraday series, so a move can be
 * measured against "where it was fifteen minutes ago" rather than against the
 * open. If the series does not reach back far enough, the earliest point is used
 * and the measured move is therefore conservative — never larger than the real
 * one over that window.
 */
export function referencePrice(series, at) {
  if (!Array.isArray(series) || !series.length) return NaN;
  let best = NaN;
  for (const point of series) {
    if (!point || !Number.isFinite(point.t) || !Number.isFinite(point.p)) continue;
    if (point.t <= at) best = point.p;
    else break;
  }
  if (Number.isFinite(best)) return best;
  const first = series.find((point) => point && Number.isFinite(point.p));
  return first ? first.p : NaN;
}

/**
 * Big moves: a percentage jump or drop inside a short window.
 *
 * This is the rule a price level cannot express — "tell me if anything I follow
 * moves hard in the next quarter of an hour" — and it is deliberately measured
 * from the intraday series rather than from a stored sample, so it costs no
 * writes and survives a Worker restart. One message per direction per window,
 * then the cooldown applies like every other rule.
 */
export function dueMoveAlerts(moves, quotes, fired = {}, now = Date.now(), cooldown = REARM_MS) {
  if (!moves || !moves.on) return [];
  const out = [];
  for (const s of moves.symbols) {
    const q = quotes[sym(s)];
    if (!q || typeof q !== "object") continue;
    const price = quotePrice(q);
    const ref = referencePrice(q.series, now - moves.window * 60 * 1000);
    if (!Number.isFinite(price) || !Number.isFinite(ref) || ref <= 0) continue;
    const pct = (price / ref - 1) * 100;

    for (const dir of ["up", "down"]) {
      const threshold = dir === "up" ? moves.up : moves.down;
      if (!(threshold > 0)) continue;
      const hit = dir === "up" ? pct >= threshold : pct <= -threshold;
      if (!hit) continue;
      const k = `move:${sym(s)}:${dir}:${moves.window}:${threshold}`;
      if (stillQuiet(fired[k], now, cooldown)) continue;
      out.push({
        sym: sym(s),
        dir,
        pct,
        window: moves.window,
        threshold,
        price,
        from: ref,
        key: k,
      });
    }
  }
  return out;
}

/**
 * Calendar events inside their lead window.
 *
 * `releases` adds a second notification when the figure is published, which is
 * the moment a trader actually wants a phone to buzz. `keywords` / `mute` narrow
 * which releases are worth waking someone for (CPI and the Fed for one person,
 * everything for another), and are plain title matches like the news filters.
 */
export function dueCalendarAlerts(rules, events, fired = {}, now = Date.now()) {
  const due = [];
  if (!rules.on || !Array.isArray(events)) return due;
  const leadMs = rules.lead * 60 * 1000;
  const keys = (rules.keywords || []).map((w) => w.toLowerCase());
  const mute = (rules.mute || []).map((w) => w.toLowerCase());

  for (const e of events) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    const impactOk =
      rules.impact === "All" ? true : rules.impact === "High" ? e.impact === "High" : /High|Medium/i.test(e.impact || "");
    if (!impactOk) continue;

    const title = String(e.title || "");
    const lower = title.toLowerCase();
    if (mute.some((w) => lower.includes(w))) continue;
    if (keys.length && !keys.some((w) => lower.includes(w))) continue;

    const k = `cal:${e.title}|${e.date}`;
    if (t > now && t - now <= leadMs && !fired[k]) {
      due.push({ kind: "soon", key: k, title: e.title, impact: e.impact, when: t, minutes: Math.max(1, Math.round((t - now) / 60000)), forecast: e.forecast });
    }
    if (rules.releases && e.actual && t <= now && t > now - 3600000 && !fired[`${k}:rel`]) {
      due.push({ kind: "released", key: `${k}:rel`, title: e.title, actual: e.actual, forecast: e.forecast });
    }
  }
  return due;
}

/**
 * Headlines worth waking someone for.
 *
 * Three filters, each optional and each stated plainly in the UI: symbols the
 * headline has to mention, words it has to contain, and words that rule it out.
 * A symbol filter and a word filter both apply when both are set — the rule
 * reads as "headlines about NVDA that mention earnings". No sentiment inference
 * and no scoring: a match is a string match, which is a claim that can be
 * checked by reading the headline.
 */
export function dueNewsAlerts(rules, headlines, now = Date.now()) {
  if (!rules.on || !Array.isArray(headlines)) return [];
  const wanted = (rules.symbols || []).map((s) => sym(s));
  const keys = (rules.keywords || []).map((w) => w.toLowerCase());
  const mute = (rules.mute || []).map((w) => w.toLowerCase());

  const fresh = headlines.filter((h) => {
    const t = Date.parse(h.publishedAt);
    return Number.isFinite(t) && now - t <= NEWS_WINDOW_MS && now - t > -60000;
  });

  const matched = fresh.filter((h) => {
    const text = `${h.title || ""} ${h.summary || ""}`;
    const lower = text.toLowerCase();
    if (mute.some((w) => lower.includes(w))) return false;
    if (wanted.length && !wanted.some((w) => text.toUpperCase().includes(w))) return false;
    if (keys.length && !keys.some((w) => lower.includes(w))) return false;
    return true;
  });

  // One message per tick, not one per headline: a chat that buzzes four times
  // in a minute gets muted, and a muted alert is a missed alert.
  return matched.slice(0, 4);
}

/* ---------------------------------------------------------------- quotes --- */

/* Alert evaluation needs a current price, which is a different question from the
 * daily bars the desk replays: it wants the latest print, not the last session.
 * Yahoo answers it with the same chart endpoint already used for bars, so no new
 * dependency and no new key.
 *
 * One request per symbol per minute serves every rule: the last price, the
 * previous close (for the percent rules) and — only when a move rule needs it —
 * the intraday closes and their timestamps. The cache is what keeps ten
 * subscribers watching SPY from costing ten upstream requests. */

export const QUOTE_TTL_MS = 60 * 1000;
const QUOTE_CACHE = new Map();

export function _clearQuoteCache() {
  QUOTE_CACHE.clear();
}

export async function fetchQuotes(symbols, { fetcher = fetch, now = Date.now, cache = QUOTE_CACHE, series = false } = {}) {
  const out = {};
  const wanted = [...new Set(symbols.map(sym).filter(Boolean))].slice(0, 12);
  const need = [];
  for (const s of wanted) {
    const hit = cache.get(s);
    if (hit && now() - hit.at < QUOTE_TTL_MS && (!series || hit.series)) out[s] = hit.quote;
    else need.push(s);
  }
  if (!need.length) return out;

  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  await Promise.all(
    need.map(async (s) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d`;
        const res = await fetcher(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (!res.ok) return;
        const j = await res.json();
        const r = j && j.chart && j.chart.result && j.chart.result[0];
        const quote = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
        const closes = quote && quote.close;
        const stamps = r && r.timestamp;

        // Walk back past the nulls Yahoo leaves for bars with no print.
        let price = null;
        if (Array.isArray(closes)) {
          for (let i = closes.length - 1; i >= 0; i--) {
            if (Number.isFinite(closes[i])) {
              price = closes[i];
              break;
            }
          }
        }
        const metaPrice = (r && r.meta && Number(r.meta.regularMarketPrice)) || null;
        const px = Number.isFinite(metaPrice) ? metaPrice : price;
        if (!Number.isFinite(px)) return;

        const prevClose = r && r.meta ? Number(r.meta.chartPreviousClose) || Number(r.meta.previousClose) : NaN;
        const value = { price: px };
        if (Number.isFinite(prevClose) && prevClose > 0) value.prevClose = prevClose;

        let points = null;
        if (series && Array.isArray(closes) && Array.isArray(stamps)) {
          points = [];
          for (let i = 0; i < closes.length; i++) {
            if (Number.isFinite(closes[i]) && Number.isFinite(stamps[i])) {
              points.push({ t: stamps[i] * 1000, p: closes[i] });
            }
          }
          if (points.length) value.series = points;
        }

        out[s] = value;
        cache.set(s, { at: now(), quote: value, series: points });
      } catch {
        /* one symbol failing must not stop the others */
      }
    })
  );
  return out;
}

/** The symbols a move rule watches when it does not name its own. */
export function defaultMoveSymbols(env) {
  const raw = String((env && env.DESK_SYMBOLS) || "SPY,QQQ,AAPL,NVDA,TSLA");
  return symbolList(raw.split(","), LIMITS.moveSymbols);
}

/* ------------------------------------------------------------------ tick --- */

/**
 * One evaluation pass over every subscription.
 *
 * This is the only place that spends CPU or makes an outbound request. The order
 * is chosen so a quiet tick is nearly free:
 *
 *   1. Read the list. One list call plus one read per record — cheap, and it
 *      happens whether or not anything fires.
 *   2. Drop anything paused or inside its quiet hours before doing any work, so
 *      silence costs nothing rather than costing a quote fetch.
 *   3. Compute which price rules are *true* before fetching any quote. This is
 *      the important one: if no subscriber has a price rule inside its range,
 *      no quote is fetched at all, so a tick with nothing to do makes zero
 *      upstream requests.
 *   4. Fetch only the quotes some rule actually needs.
 *   5. Evaluate, send, and write only the records that fired.
 *
 * `now` and `fetcher` are injectable, which is how the tests run a real tick
 * against a stubbed clock, KV and network rather than mocking this logic.
 */
export async function runAlertTick({
  env,
  now = Date.now,
  fetcher = fetch,
  news = [],
  events = [],
  limit = MAX_SENDS_PER_TICK,
  force = false,
}) {
  const started = now();
  const kv = env && env.CACHE;
  const summary = { checked: 0, sent: 0, removed: 0, skipped: 0, paused: 0, quiet: 0, configured: false, errors: [] };

  if (!telegramReady(env) || !kv) {
    summary.errors.push("Telegram alerts are not configured on the server.");
    return summary;
  }
  summary.configured = true;

  let subs;
  try {
    subs = await listSubscriptions(kv);
  } catch (e) {
    summary.errors.push(`Could not read subscriptions: ${(e && e.message) || e}`);
    return summary;
  }
  if (!subs.length) return summary;

  // Which symbols any price or move rule could possibly need, and whether an
  // intraday series has to come with them. A rule is only worth a quote when it
  // has not fired recently — that check happens before the fetch so a quiet
  // subscriber costs nothing at all.
  const wanted = new Set();
  let needSeries = false;
  const live = [];
  const fallbackSymbols = defaultMoveSymbols(env);

  for (const rec of subs) {
    if (!rec.chatId) continue; // a half-finished record is not a subscriber

    const rules = cleanRules(rec.rules);
    if (rules.paused) {
      summary.paused++;
      continue;
    }
    if (quietNow(rules.quiet, started)) {
      // Deferred rather than dropped: nothing is marked as fired, so a rule that
      // is still true when the window ends speaks then.
      summary.quiet++;
      continue;
    }

    const fired = rec.fired || {};
    const cooldown = rearmMs(rules);
    const moves = { ...rules.moves, symbols: rules.moves.symbols.length ? rules.moves.symbols : fallbackSymbols };
    const candidates = rules.price.filter((r) => !stillQuiet(fired[`price:${sym(r.sym)}:${r.type}:${r.val}`], started, cooldown));
    const moveCandidates = rules.moves.on ? moves.symbols.filter((s) => !stillQuiet(fired[`move:${s}:up:${moves.window}:${moves.up}`], started, cooldown) || !stillQuiet(fired[`move:${s}:down:${moves.window}:${moves.down}`], started, cooldown)) : [];

    if (candidates.length) for (const r of candidates) wanted.add(sym(r.sym));
    if (moveCandidates.length) {
      needSeries = true;
      for (const s of moveCandidates) wanted.add(sym(s));
    }
    live.push({ rec, rules, moves, cooldown, candidates, moveCandidates });
  }

  let quotes = {};
  if (wanted.size) {
    try {
      quotes = await fetchQuotes([...wanted], { fetcher, now, series: needSeries });
    } catch (e) {
      summary.errors.push(`Quote fetch failed: ${(e && e.message) || e}`);
    }
  }

  for (const { rec, rules, moves, cooldown, candidates, moveCandidates } of live) {
    summary.checked++;
    const fired = { ...(rec.fired || {}) };
    const sends = [];

    for (const r of duePriceAlerts(candidates, quotes, fired, started, cooldown)) {
      sends.push({ kind: "price", detail: r });
      fired[r.key] = started;
    }

    for (const m of dueMoveAlerts({ ...moves, symbols: moveCandidates }, quotes, fired, started, cooldown)) {
      sends.push({ kind: "move", detail: m });
      fired[m.key] = started;
    }

    const newsHits = dueNewsAlerts(rules.news, news, started);
    if (newsHits.length) {
      // Keyed by the newest headline's timestamp so the same story cannot be
      // sent twice by two adjacent ticks, and a fresh story always can.
      const k = `news:${newsHits[0].publishedAt || started}`;
      if (!fired[k]) {
        sends.push({ kind: "news", detail: { items: newsHits } });
        fired[k] = started;
      }
    }

    for (const c of dueCalendarAlerts(rules.calendar, events, fired, started)) {
      const detail = { ...c, when: c.when || started };
      sends.push({ kind: c.kind === "released" ? "calendar-released" : "calendar-soon", detail });
      fired[c.key] = started;
    }

    if (!sends.length) continue;
    if (summary.sent >= limit) {
      // Bounded work per invocation. The rules stay armed, so the next tick
      // picks this subscriber up; nothing is lost, only deferred.
      summary.skipped++;
      continue;
    }

    let changed = false;
    let dead = false;
    for (const s of sends) {
      if (summary.sent >= limit) {
        summary.skipped++;
        break;
      }
      try {
        const r = await sendTelegram({
          env,
          chatId: rec.chatId,
          text: alertText(s.kind, s.detail, env),
          fetcher,
        });
        if (r.ok) {
          summary.sent++;
          changed = true;
        } else if (r.gone) {
          // The person blocked the bot or deleted the chat. Removing the record
          // is the only correct response, and it keeps the store clean without a
          // manual sweep.
          dead = true;
          break;
        } else {
          summary.errors.push(`${s.kind}: ${r.reason || r.status || "send failed"}`);
        }
      } catch (e) {
        summary.errors.push(`${s.kind}: ${(e && e.message) || e}`);
      }
    }

    if (dead) {
      await deleteSubscription(kv, rec.id);
      summary.removed++;
      continue;
    }

    if (changed) {
      // Prune anything older than a day so a long-lived subscription cannot
      // grow a fired-map that eventually bloats every read.
      const cut = started - 86400000;
      for (const k of Object.keys(fired)) if (Number(fired[k]) < cut) delete fired[k];
      await putSubscription(kv, { ...rec, rules, fired, lastSentAt: new Date(started).toISOString() });
    }
  }

  return summary;
}
