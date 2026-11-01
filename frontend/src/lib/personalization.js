/*
 * Account-free personalization.
 *
 * The landing page and the desk are served from the same origin, so they can
 * share the same two localStorage keys: `wl` for the watchlist and
 * `deskprefs` for the default symbol, timeframe and opening tab. There is no
 * profile on a server and no identifier linking one browser to another.
 *
 * The desk's own storage proxy tolerates a missing or malformed value. These
 * helpers do the same: a corrupt entry falls back to the shipped defaults
 * rather than breaking the page.
 */

export const WATCHLIST_KEY = "wl";
export const PREFS_KEY = "deskprefs";
export const WATCHLIST_EVENT = "tickspy:watchlist";

export const DEFAULT_WATCHLIST = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];
export const MAX_WATCHLIST = 12;

export const TIMEFRAMES = [
  { id: "1Min", label: "1 minute" },
  { id: "5Min", label: "5 minutes" },
  { id: "15Min", label: "15 minutes" },
  { id: "1Day", label: "1 day" },
];

export const DESK_TABS = [
  { id: "live", label: "Overview" },
  { id: "assistant", label: "Assistant" },
  { id: "research", label: "Research" },
  { id: "interpret", label: "Interpreter" },
  { id: "ind", label: "Indicators" },
  { id: "pat", label: "Patterns" },
  { id: "structure", label: "Structure" },
  { id: "vol", label: "Volatility" },
  { id: "news", label: "News" },
  { id: "cal", label: "Calendar" },
  { id: "alert", label: "Alerts" },
  { id: "tools", label: "Risk & testing" },
  { id: "learn", label: "Learn" },
  { id: "set", label: "Settings" },
];

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const TIMEFRAME_IDS = new Set(TIMEFRAMES.map((t) => t.id));
const TAB_IDS = new Set(DESK_TABS.map((t) => t.id));

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (_) {
    return null;
  }
}

function readJSON(key) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function cleanWatchlist(value) {
  const input = Array.isArray(value) ? value : [];
  const out = [];
  for (const item of input) {
    const symbol = String(item || "").trim().toUpperCase();
    if (!TICKER.test(symbol) || out.includes(symbol)) continue;
    out.push(symbol);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out;
}

export function readWatchlist() {
  const saved = readJSON(WATCHLIST_KEY);
  if (saved === null) return [...DEFAULT_WATCHLIST];
  return cleanWatchlist(saved);
}

export function writeWatchlist(value) {
  const list = cleanWatchlist(value);
  const store = storage();
  try {
    store?.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch (_) {
    // Private mode: the page still works for this visit.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT, { detail: list }));
  }
  return list;
}

/** Add one symbol, with the same rules the desk applies. */
export function addWatchlistSymbol(value, list = readWatchlist()) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!TICKER.test(symbol)) return { ok: false, message: "Enter a valid US ticker.", list };
  if (list.includes(symbol)) return { ok: false, message: `${symbol} is already on your list.`, list };
  if (list.length >= MAX_WATCHLIST) {
    return { ok: false, message: `The watchlist holds up to ${MAX_WATCHLIST} symbols.`, list };
  }
  return { ok: true, list: writeWatchlist([...list, symbol]) };
}

export function removeWatchlistSymbol(symbol, list = readWatchlist()) {
  return writeWatchlist(list.filter((s) => s !== String(symbol || "").toUpperCase()));
}

export function readDeskPrefs() {
  const saved = readJSON(PREFS_KEY);
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const list = readWatchlist();
  const symbol = String(raw.symbol || "").trim().toUpperCase();
  return {
    symbol: TICKER.test(symbol) ? symbol : list[0] || "SPY",
    timeframe: TIMEFRAME_IDS.has(raw.timeframe) ? raw.timeframe : "1Min",
    tab: TAB_IDS.has(raw.tab) ? raw.tab : "live",
  };
}

export function writeDeskPrefs(patch = {}) {
  const next = readDeskPrefs();
  const symbol = String(patch.symbol == null ? next.symbol : patch.symbol).trim().toUpperCase();
  const timeframe = patch.timeframe == null ? next.timeframe : patch.timeframe;
  const tab = patch.tab == null ? next.tab : patch.tab;
  const prefs = {
    symbol: TICKER.test(symbol) ? symbol : next.symbol,
    timeframe: TIMEFRAME_IDS.has(timeframe) ? timeframe : next.timeframe,
    tab: TAB_IDS.has(tab) ? tab : next.tab,
  };
  const store = storage();
  try {
    store?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {
    // Session-only is acceptable; the UI says the setting is local.
  }
  return prefs;
}

export function resetPersonalization() {
  const store = storage();
  try {
    store?.setItem(WATCHLIST_KEY, JSON.stringify(DEFAULT_WATCHLIST));
    store?.setItem(PREFS_KEY, JSON.stringify({ symbol: DEFAULT_WATCHLIST[0], timeframe: "1Min", tab: "live" }));
  } catch (_) {
    // Nothing else to do.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT, { detail: [...DEFAULT_WATCHLIST] }));
  }
  return { watchlist: [...DEFAULT_WATCHLIST], prefs: readDeskPrefs() };
}
