/* freesrc.js — the desk's no-key mode.
 *
 * The desk used to be unusable until you created an Alpaca account: the first
 * thing `load()` did with no keys was bounce you to Settings. That wall is gone.
 * With no keys the desk now shows the previous completed session, replayed as
 * though it were live, served from the edge API (`/api/bars`, see ../worker and
 * worker/src/bars.js). Nothing here needs an account, a key or a payment.
 *
 * What "as if live" means, precisely
 * ----------------------------------
 * The data is one session old and never changes mid-day. The *clock* is live.
 * While the US regular session is open, the replay walks through the previous
 * session at the same time of day: at 11:00 ET you are looking at yesterday's
 * 11:00, and the chart, VWAP, opening range and volume profile all grow the way
 * they did the day before. Outside the session the whole of it is on screen,
 * because there is nothing left to replay until the bell.
 *
 * That is a simulation of a session, not a live quote, so every screen that
 * shows it says so. `labelled()` below is the single source of that wording, so
 * the desk cannot accidentally present stale prices as current ones.
 *
 * This file is deliberately dumb: pure functions, no DOM, no fetch. index.html
 * owns the wiring, and desk/tests/freesrc.js exercises all of it with no browser.
 */
(function (root) {
  "use strict";

  var RTH_OPEN = 9 * 60 + 30; // 09:30 ET
  var RTH_CLOSE = 16 * 60; // 16:00 ET

  /** The timeframes the keyless source can actually supply. */
  var TIMEFRAMES = [
    { id: "5Min", label: "5 min" },
    { id: "15Min", label: "15 min" },
    { id: "1Day", label: "1 day" },
  ];

  /** Periods per year, for the volatility model, per free timeframe. */
  var PERIODS_PER_YEAR = { "5Min": 78 * 252, "15Min": 26 * 252, "1Hour": 7 * 252, "1Day": 252 };

  var MS_DAY = 86400000;

  /* ---------------------------------------------------------------- time -- */

  function partsInET(ms) {
    var s = new Date(ms).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    // "10/08/2026, 09:30"
    var m = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return {
      date: m[3] + "-" + m[1] + "-" + m[2],
      minutes: Number(m[4]) % 24 * 60 + Number(m[5]),
    };
  }

  /** Minute-of-day on the US/Eastern clock. */
  function etMinutes(ms) {
    var p = partsInET(ms);
    return p ? p.minutes : 0;
  }

  /** `YYYY-MM-DD` on the US/Eastern clock. */
  function etDate(ms) {
    var p = partsInET(ms);
    return p ? p.date : "";
  }

  /** Offset of a zone from UTC, in ms, at a given instant (DST included). */
  function zoneOffset(zone, ms) {
    var s = new Date(ms).toLocaleString("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    var m = /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (!m) return 0;
    var naive = Date.UTC(+m[3], +m[1] - 1, +m[2], Number(m[4]) % 24, +m[5], +m[6]);
    return naive - Math.floor(ms / 1000) * 1000;
  }

  /**
   * A wall-clock time on `date` in `zone` -> the UTC instant it names. Two
   * passes, because the first guess can land on the wrong side of a DST change.
   */
  function wallToUtc(zone, date, minutes) {
    var y = +date.slice(0, 4);
    var mo = +date.slice(5, 7);
    var d = +date.slice(8, 10);
    var naive = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
    var ms = naive - zoneOffset(zone, naive);
    return naive - zoneOffset(zone, ms);
  }

  var etInstant = function (date, minutes) {
    return wallToUtc("America/New_York", date, minutes);
  };

  var isoOf = function (t) {
    return typeof t === "string" ? t : new Date(t).toISOString();
  };

  /* --------------------------------------------------------------- modes -- */

  /**
   * @param {object} cfg          { ak, as, ... } from localStorage
   * @param {object} env          { edgeApi, serverProxy }
   * @returns {"live"|"free"|"none"}
   *
   * "none" is a real state, not an error: no keys and nowhere to fetch the free
   * session from. The desk then explains the two ways to get data instead of
   * pretending to be connected.
   */
  function modeFor(cfg, env) {
    if (cfg && (cfg.ak || cfg.as)) return "live";
    if (env && env.edgeApi) return "free";
    return "none";
  }

  /* -------------------------------------------------------------- replay -- */

  /**
   * The instant inside the session that the desk should be showing right now.
   *
   * @param {number} nowMs         wall clock
   * @param {string} sessionDate   `YYYY-MM-DD` in ET, from the API payload
   * @returns {{at:Date, minutes:number, complete:boolean, live:boolean}}
   *   `live` is true only while the real session is open and the replay is
   *   therefore still advancing.
   */
  function replayAt(nowMs, sessionDate) {
    var nowMin = etMinutes(nowMs);
    var live = nowMin >= RTH_OPEN && nowMin < RTH_CLOSE;
    var cut = live ? nowMin : RTH_CLOSE;
    var at = new Date(sessionDate ? etInstant(sessionDate, cut) : nowMs);
    return { at: at, minutes: cut, complete: cut >= RTH_CLOSE, live: live };
  }

  /**
   * The bars visible at `at`.
   *
   * `minBars` guards the one failure that would look like a bug to a user: if a
   * clock or date disagreement made the cutoff land before the session opened,
   * an empty chart is a worse answer than the whole session with the label
   * saying it is complete. Ascending input order is assumed (the API guarantees
   * it), and ISO strings compare correctly as strings.
   */
  function reveal(bars, at, minBars) {
    var list = Array.isArray(bars) ? bars : [];
    if (!list.length) return list;
    var cut = typeof at === "string" ? at : new Date(at).toISOString();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isoOf(list[i].t) <= cut) out.push(list[i]);
      else break;
    }
    var floor = minBars == null ? 5 : minBars;
    return out.length >= floor ? out : list.slice();
  }

  /** A short human label for what the replay is currently showing. */
  function replayLabel(rep, sessionDate) {
    var when = sessionDate ? prettyDate(sessionDate) : "";
    if (!rep || rep.complete) return "full session" + (when ? " \u00b7 " + when : "");
    var h = Math.floor(rep.minutes / 60);
    var m = rep.minutes % 60;
    return "replaying " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + " ET" + (when ? " \u00b7 " + when : "");
  }

  /** `2026-10-08` -> `Thu 8 Oct`, with no timezone surprises. */
  function prettyDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return String(date || "");
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)));
    return names[d.getUTCDay()] + " " + d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  /**
   * The one sentence that must appear wherever free-mode prices appear. Kept in
   * one place so no screen can quietly present a replayed session as live.
   */
  /* Machine name -> the name a reader should see. The API reports whichever
     source it actually answered from, so the disclosure can name it honestly;
     brands are capitalised because they are trademarks, not nouns. */
  var SOURCE_NAMES = { yahoo: "Yahoo Finance", stooq: "Stooq", mixed: "the free sources", hfdatalibrary: "HF Data Library (IEX)" };

  function labelled(payload) {
    var raw = payload && payload.source;
    var src = raw ? SOURCE_NAMES[raw] || raw : "the free feed";
    var when = payload && payload.sessionDate ? prettyDate(payload.sessionDate) : "the last session";
    var base = "Previous session (" + when + "), delayed end-of-day data from " + src + ". Replayed as if live; not a current quote.";
    if (raw === "hfdatalibrary") base += " Data sourced from IEX exchange only (~2-3% of consolidated volume).";
    return base;
  }

  /* --------------------------------------------------------------- fetch -- */

  function hfdataUrl(symbol, tf) {
    return "/desk/hfdata/" + encodeURIComponent(String(symbol || "").toUpperCase()) + ".json";
  }

  function barsPath(symbol, tf) {
    return hfdataUrl(symbol, tf);
  }

  function symbolsPath(symbols, tf) {
    return (symbols || []).map(function (s) { return hfdataUrl(s, tf); });
  }

  async function fetchHfdata(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    return res.json();
  }

  async function fetchBars(symbol, tf) {
    return fetchHfdata(hfdataUrl(symbol, tf));
  }

  async function fetchSymbols(symbols, tf) {
    const urls = symbolsPath(symbols, tf);
    const results = await Promise.all(urls.map(u => fetchHfdata(u).catch(() => null)));
    const bars = {};
    results.forEach((r, i) => { if (r && r.bars) bars[symbols[i]] = r.bars; });
    return { bars };
  }

  /* ---------------------------------------------------------- derived data -- */

  /**
   * Watchlist quotes from daily bars: last close and the change against the
   * session before it. Mirrors the shape the live path already builds, so the
   * watchlist renderer does not need to care which mode it is in.
   */
  function quotesFromDaily(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (sym) {
      var bars = map[sym] || [];
      if (bars.length > 1) {
        out[sym] = { p: bars[bars.length - 1].c, ch: (bars[bars.length - 1].c - bars[bars.length - 2].c) / bars[bars.length - 2].c * 100 };
      } else if (bars.length === 1) {
        out[sym] = { p: bars[0].c, ch: 0 };
      }
    });
    return out;
  }

  /** The biggest movers in a set of quotes, for the free replacement scanner. */
  function movers(quotes, limit) {
    return Object.keys(quotes || {})
      .map(function (s) { return { s: s, p: quotes[s].p, ch: quotes[s].ch }; })
      .sort(function (a, b) { return Math.abs(b.ch) - Math.abs(a.ch); })
      .slice(0, limit == null ? 8 : limit);
  }

  /**
   * Company names, so the aggregated market headlines can stand in for the
   * per-symbol news feed that needs Alpaca. Only a fallback: a headline is shown
   * if it names the ticker or one of these aliases.
   */
  var ALIASES = {
    SPY: ["S&P", "S&P 500", "SPX"],
    QQQ: ["Nasdaq 100", "Nasdaq-100"],
    DIA: ["Dow", "Dow Jones"],
    IWM: ["Russell 2000"],
    AAPL: ["Apple"],
    NVDA: ["Nvidia"],
    TSLA: ["Tesla"],
    MSFT: ["Microsoft"],
    AMZN: ["Amazon"],
    META: ["Meta", "Facebook"],
    GOOGL: ["Google", "Alphabet"],
    GOOG: ["Google", "Alphabet"],
    AMD: ["Advanced Micro"],
    NFLX: ["Netflix"],
    JPM: ["JPMorgan"],
    XOM: ["Exxon"],
    CVX: ["Chevron"],
    BA: ["Boeing"],
    DIS: ["Disney"],
    INTC: ["Intel"],
    KO: ["Coca-Cola"],
    PEP: ["Pepsi"],
    WMT: ["Walmart"],
    GS: ["Goldman"],
    V: ["Visa"],
    UNH: ["UnitedHealth"],
    COIN: ["Coinbase"],
    MSTR: ["MicroStrategy"],
    PLTR: ["Palantir"],
  };

  /**
   * The words a headline has to contain to be counted as about this symbol.
   *
   * A one-character ticker is left out on purpose: no wording rule can tell the
   * stock V apart from "V-shaped recovery", so V is matched by its name only.
   */
  function symbolTerms(symbol) {
    var s = String(symbol || "").toUpperCase();
    var list = s.length >= 2 ? [s] : [];
    for (var i = 0; i < (ALIASES[s] || []).length; i++) list.push(ALIASES[s][i]);
    return list;
  }

  /** Case-insensitive, word-bounded: "V" must not match every "vs". */
  function mentions(text, term) {
    var hay = String(text || "");
    var needle = String(term || "");
    if (!needle) return false;
    var escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A leading/trailing non-word character in the alias (S&P, Nasdaq-100) still
    // needs the boundaries, so only require them where the alias has a word edge.
    var pre = /^\w/.test(needle) ? "\\b" : "";
    var post = /\w$/.test(needle) ? "\\b" : "";
    return new RegExp(pre + escaped + post, "i").test(hay);
  }

  /** Market headlines that mention this symbol, for the free symbol-news panel.
   *  A best effort, and labelled as such in the UI: it is an aggregator's
   *  headlines filtered by name, not that company's news feed. */
  function newsForSymbol(items, symbol, limit) {
    var terms = symbolTerms(symbol);
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var n = items[i];
      var hay = (n.title || "") + " " + (n.summary || "");
      for (var j = 0; j < terms.length; j++) {
        if (mentions(hay, terms[j])) { out.push(n); break; }
      }
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  /* ------------------------------------------------------------ timestamp -- */

  /**
   * The session's own clock, for the desk's header. In free mode the desk shows
   * the replayed time rather than the wall clock, so the phase label under it
   * ("Morning", "Midday") describes the bars on screen.
   */
  function displayClock(rep, nowMs, sessionDate) {
    if (!rep || rep.complete || !sessionDate) {
      var p = partsInET(nowMs);
      return {
        h: Math.floor((p ? p.minutes : 0) / 60),
        mi: (p ? p.minutes : 0) % 60,
        s: new Date(nowMs).getSeconds(),
        date: etDate(nowMs),
        minutes: p ? p.minutes : 0,
        live: false,
      };
    }
    return {
      h: Math.floor(rep.minutes / 60),
      mi: rep.minutes % 60,
      // The replay moves in whole bars, so the seconds come from the real clock.
      // That is what makes the header read as live while the data steps forward
      // one five-minute bar at a time.
      s: new Date(nowMs).getSeconds(),
      date: sessionDate,
      minutes: rep.minutes,
      live: true,
    };
  }

  var api = {
    RTH_OPEN: RTH_OPEN,
    RTH_CLOSE: RTH_CLOSE,
    TIMEFRAMES: TIMEFRAMES,
    PERIODS_PER_YEAR: PERIODS_PER_YEAR,
    modeFor: modeFor,
    partsInET: partsInET,
    etMinutes: etMinutes,
    etDate: etDate,
    wallToUtc: wallToUtc,
    etInstant: etInstant,
    replayAt: replayAt,
    replayLabel: replayLabel,
    reveal: reveal,
    prettyDate: prettyDate,
    labelled: labelled,
    barsPath: barsPath,
    symbolsPath: symbolsPath,
    fetchBars: fetchBars,
    fetchSymbols: fetchSymbols,
    quotesFromDaily: quotesFromDaily,
    movers: movers,
    symbolTerms: symbolTerms,
    mentions: mentions,
    newsForSymbol: newsForSymbol,
    displayClock: displayClock,
  };

  root.DeskFree = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
