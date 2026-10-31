/*
 * The browser half of Telegram alerts.
 *
 * The Worker owns the bot, the five-minute evaluation and the subscription
 * record. This module only does what a page is allowed to do: ask for a one-time
 * link code, poll until the bot consumes it, and then keep the returned id and
 * token in this browser so the same subscription can be changed or deleted.
 *
 * It deliberately never sees a chat id. The server returns a short label
 * ("Alex", or a group title) and nothing that identifies a Telegram account.
 */
import { EDGE_API } from "./edge";
import { cleanWatchlist } from "./personalization";

const SUB_KEY = "tgsub";
const RULES_KEY = "tgrules";
const REQUEST_TIMEOUT_MS = 15_000;
const ID_RE = /^[0-9a-f]{32}$/;
const TOKEN_RE = /^[0-9a-f]{48}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function zone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (_) {
    return "UTC";
  }
}

/** The shape the Worker's `cleanRules()` fills in, with safe defaults. */
export function defaultRules() {
  return {
    price: [],
    moves: { on: false, up: 2, down: 2, window: 15, symbols: [] },
    news: { on: false, symbols: [], keywords: [], mute: [] },
    calendar: { on: false, impact: "HighMedium", lead: 15, releases: false, keywords: [], mute: [] },
    quiet: { on: false, from: "22:00", to: "07:00", tz: zone() },
    rearm: 30,
    paused: false,
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

/** Merge a saved or server rule set into the current shape without dropping it. */
export function mergeRules(raw) {
  const d = defaultRules();
  const src = object(raw);
  return {
    ...d,
    ...src,
    price: array(src.price)
      .filter((r) => r && TICKER_RE.test(String(r.sym || "").toUpperCase()) && Number.isFinite(Number(r.val)))
      .map((r) => ({ sym: String(r.sym).toUpperCase(), type: String(r.type), val: Number(r.val) }))
      .slice(0, 20),
    moves: { ...d.moves, ...object(src.moves), symbols: cleanWatchlist(array(object(src.moves).symbols)).slice(0, 12) },
    news: {
      ...d.news,
      ...object(src.news),
      symbols: cleanWatchlist(array(object(src.news).symbols)).slice(0, 10),
      keywords: array(object(src.news).keywords).slice(0, 10),
      mute: array(object(src.news).mute).slice(0, 10),
    },
    calendar: { ...d.calendar, ...object(src.calendar), keywords: array(object(src.calendar).keywords).slice(0, 10), mute: array(object(src.calendar).mute).slice(0, 10) },
    quiet: { ...d.quiet, ...object(src.quiet), tz: String(object(src.quiet).tz || d.quiet.tz) },
    rearm: Number.isFinite(Number(src.rearm)) ? Math.min(240, Math.max(10, Math.round(Number(src.rearm)))) : d.rearm,
    paused: Boolean(src.paused),
  };
}

export function readRules() {
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? mergeRules(JSON.parse(raw)) : defaultRules();
  } catch (_) {
    return defaultRules();
  }
}

export function rememberRules(rules) {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(mergeRules(rules)));
  } catch (_) {
    // Private mode: the form still works for this visit.
  }
}

/**
 * Add the simple choices from the landing page to whatever the browser already
 * had. The full desk editor remains the place for move, quiet-hour and keyword
 * rules; this only changes the three switches it shows.
 */
export function buildSiteRules({ base, watchlist, price, headlines, calendar }) {
  const rules = mergeRules(base);
  if (price && TICKER_RE.test(String(price.sym || "").toUpperCase()) && Number.isFinite(Number(price.val)) && Number(price.val) > 0) {
    const next = { sym: String(price.sym).toUpperCase(), type: price.type === "below" ? "below" : "above", val: Number(price.val) };
    rules.price = [...rules.price.filter((r) => !(r.sym === next.sym && r.type === next.type && r.val === next.val)), next].slice(-20);
  }
  const symbols = cleanWatchlist(watchlist).slice(0, 10);
  rules.news = {
    ...rules.news,
    on: Boolean(headlines),
    symbols: headlines ? symbols : rules.news.symbols,
  };
  rules.calendar = { ...rules.calendar, on: Boolean(calendar) };
  return rules;
}

export function ruleCount(rules) {
  const r = mergeRules(rules);
  return r.price.length + (r.moves.on ? 1 : 0) + (r.news.on ? 1 : 0) + (r.calendar.on ? 1 : 0);
}

function cleanSubscription(raw) {
  const s = object(raw);
  if (!ID_RE.test(String(s.id || "")) || !TOKEN_RE.test(String(s.token || ""))) return null;
  return {
    id: String(s.id),
    token: String(s.token),
    chat: String(s.chat || "Telegram chat").slice(0, 60),
    lastSentAt: s.lastSentAt || null,
  };
}

export function storedSubscription() {
  try {
    const raw = window.localStorage.getItem(SUB_KEY);
    return raw ? cleanSubscription(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

export function rememberSubscription(sub) {
  const clean = cleanSubscription(sub);
  if (!clean) return null;
  try {
    window.localStorage.setItem(SUB_KEY, JSON.stringify(clean));
  } catch (_) {
    // Session-only is still enough to change or delete it during this visit.
  }
  return clean;
}

export function forgetSubscription() {
  try {
    window.localStorage.removeItem(SUB_KEY);
  } catch (_) {
    // Nothing else to do.
  }
}

function timeoutSignal(signal, ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function request(path, { method = "GET", body, signal } = {}) {
  const timeout = timeoutSignal(signal);
  try {
    const res = await fetch(`${EDGE_API}${path}`, {
      method,
      mode: "cors",
      credentials: "omit",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.message || "The alerts service could not answer.");
      error.code = data.error || `http_${res.status}`;
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("The alerts service took too long to answer.");
      timeoutError.code = "timeout";
      throw timeoutError;
    }
    if (!error.code) error.code = "network";
    throw error;
  } finally {
    timeout.done();
  }
}

export function alertConfig() {
  return request("/api/alerts/config");
}

export function startLink(rules) {
  return request("/api/alerts/link/start", { method: "POST", body: { rules } });
}

export function linkStatus(code) {
  return request(`/api/alerts/link/status?code=${encodeURIComponent(code)}`);
}

export function saveRules(id, token, rules) {
  return request("/api/alerts/rules", { method: "POST", body: { id, token, rules } });
}

export function sendTest(id, token) {
  return request("/api/alerts/test", { method: "POST", body: { id, token } });
}

export function unsubscribe(id, token) {
  return request("/api/alerts/unsubscribe", { method: "POST", body: { id, token } });
}

export { EDGE_API };
