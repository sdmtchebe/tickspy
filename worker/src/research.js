/* research.js — the daily research brief, computed rather than generated.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The desk already has an AI overview for headlines, but a headline summary is
 * not research. This module answers a narrower and more useful set of
 * questions, from numbers that can be checked:
 *
 *   - What is the current state of this symbol, measured against its own
 *     history rather than against a generic label?
 *   - How wide does the next session's high-low range tend to be, given the
 *     volatility it is in now?
 *   - How often has that range estimate actually contained the next session?
 *
 * Every sentence in the brief is assembled here from a fact that is also
 * returned to the caller. There is no language model in this path, no user
 * text, and no web browsing. That is the reliability contract: if a number is
 * not in `evidence`, it cannot appear in the prose.
 *
 * THE MODEL
 * ---------
 * The range model is a one-dimensional k-nearest-neighbour regression, not a
 * black box:
 *
 *   score at close t:  0.65 * log(realized vol 20) + 0.35 * log(ATR14 / price)
 *   target at close t: (high[t+1] - low[t+1]) / close[t]
 *
 * One dimension is deliberate. With roughly two years of daily bars, a richer
 * feature space starts finding neighbours that are close on four axes and far
 * away on the one that matters. Volatility is the dominant driver of the next
 * session's range; ATR adds the intraday part of it. The score is monotonic in
 * both, so "nearest by score" has a plain reading: historical sessions in a
 * similar volatility state.
 *
 * For a prediction at t, only neighbours j < t are eligible, and target j is
 * the session after j, so everything a neighbour contributes was already known
 * at the prediction close. The 5th/10th/25th/50th/75th/90th/95th percentiles of
 * the neighbours' targets become the range bands. The backtest repeats that
 * exact walk-forward procedure over the last 120 sessions and reports how often
 * each band contained the actual range. No future bar is ever used to build a
 * prediction or its scorecard.
 *
 * Vocabulary is deliberately descriptive: "up trend", "range", "mixed". There
 * is no buy/sell language anywhere in this file, because a range estimate is a
 * statement about dispersion, not direction.
 */

/* ---------------------------------------------------------------- constants -- */

/** Below this many daily bars the brief is not meaningful. */
export const MIN_BRIEF_BARS = 40;

/** The model needs enough neighbours to make a stable quantile. */
export const MODEL_MIN_BARS = 80;

/** Neighbours used for each prediction. 40 keeps the tails from being one bar. */
export const MODEL_NEIGHBOURS = 40;

/** How far back a prediction may look for neighbours. */
export const MODEL_MAX_HISTORY = 500;

/** Sessions scored in the walk-forward backtest. */
export const BACKTEST_SESSIONS = 120;

/* ------------------------------------------------------------------ helpers -- */

const finite = (x) => Number.isFinite(x);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function stdev(xs) {
  if (xs.length < 2) return null;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

function quantileSorted(xs, p) {
  if (!xs.length) return null;
  const clamped = Math.min(1, Math.max(0, p));
  const i = (xs.length - 1) * clamped;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
}

const round = (x, digits = 4) => (finite(x) ? Number(x.toFixed(digits)) : null);
const dateOf = (t) => String(t || "").slice(0, 10);
const safeLog = (x) => Math.log(Math.max(Number(x) || 0, 1e-6));

/* ------------------------------------------------------------- price series -- */

/**
 * Wilder ATR. The returned array is aligned with `bars`: entry i is the ATR
 * known at the close of bar i, and is null until 14 bars exist.
 */
export function atrSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= n) return out;
  const tr = new Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    tr[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += tr[i];
  out[n] = sum / n;
  for (let i = n + 1; i < bars.length; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  return out;
}

/** Annualized standard deviation of log returns over `n` sessions. */
export function realizedVolSeries(bars, n = 20) {
  const out = new Array(bars.length).fill(null);
  const rets = new Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].c > 0 && bars[i].c > 0) rets[i] = Math.log(bars[i].c / bars[i - 1].c);
  }
  for (let i = n; i < bars.length; i++) {
    const window = rets.slice(i - n + 1, i + 1);
    if (window.every(finite)) out[i] = stdev(window) * Math.sqrt(252);
  }
  return out;
}

/** Percentile (0..1) of the current realized volatility inside its own history. */
export function volPercentileAt(rv, i, lookback = 252) {
  if (!Number.isInteger(i) || i < 0 || i >= rv.length || !finite(rv[i])) return null;
  const window = rv.slice(Math.max(0, i - lookback + 1), i + 1).filter(finite);
  // A percentile from a handful of observations is noise wearing a number.
  if (window.length < 60) return null;
  return window.filter((v) => v <= rv[i]).length / window.length;
}

/** Wilder ADX, aligned with bars. null until 2n bars exist. */
export function adxSeries(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < 2 * n + 1) return out;
  const tr = new Array(bars.length).fill(null);
  const pdm = new Array(bars.length).fill(null);
  const ndm = new Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    tr[i] = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    const up = b.h - p.h;
    const down = p.l - b.l;
    pdm[i] = up > down && up > 0 ? up : 0;
    ndm[i] = down > up && down > 0 ? down : 0;
  }
  let atr = avg(tr.slice(1, n + 1));
  let plus = avg(pdm.slice(1, n + 1));
  let minus = avg(ndm.slice(1, n + 1));
  const dx = new Array(bars.length).fill(null);
  const dxAt = () => {
    const pi = (100 * plus) / (atr || 1e-9);
    const ni = (100 * minus) / (atr || 1e-9);
    return (100 * Math.abs(pi - ni)) / (pi + ni || 1e-9);
  };
  dx[n] = dxAt();
  for (let i = n + 1; i < bars.length; i++) {
    atr = (atr * (n - 1) + tr[i]) / n;
    plus = (plus * (n - 1) + pdm[i]) / n;
    minus = (minus * (n - 1) + ndm[i]) / n;
    dx[i] = dxAt();
  }
  let adx = avg(dx.slice(n, 2 * n));
  out[2 * n - 1] = adx;
  for (let i = 2 * n; i < bars.length; i++) {
    adx = (adx * (n - 1) + dx[i]) / n;
    out[i] = adx;
  }
  return out;
}

export function emaSeries(closes, n) {
  if (!closes.length) return [];
  const k = 2 / (n + 1);
  let e = closes[0];
  return closes.map((x, i) => {
    if (i) e = x * k + e * (1 - k);
    return e;
  });
}

/** Kaufman efficiency: net move divided by the path travelled, 0..1. */
export function efficiencyAt(bars, i, n = 20) {
  if (i < n || i >= bars.length) return null;
  let path = 0;
  for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].c - bars[j - 1].c);
  return path > 0 ? Math.abs(bars[i].c - bars[i - n].c) / path : null;
}

/**
 * Confirmed pivot zones from the last `lookback` bars. A pivot needs `wing`
 * bars on both sides, so the last few bars cannot form one: that is what keeps
 * a zone from being drawn through the bar currently forming.
 */
export function pivotZones(bars, { lookback = 120, wing = 3, atr = null } = {}) {
  const start = Math.max(wing, bars.length - lookback);
  const end = bars.length - wing;
  const pivots = [];
  for (let i = start; i < end; i++) {
    let high = true;
    let low = true;
    for (let j = 1; j <= wing; j++) {
      if (bars[i].h <= bars[i - j].h || bars[i].h <= bars[i + j].h) high = false;
      if (bars[i].l >= bars[i - j].l || bars[i].l >= bars[i + j].l) low = false;
    }
    if (high) pivots.push({ price: bars[i].h, i });
    if (low) pivots.push({ price: bars[i].l, i });
  }
  const close = bars.length ? bars[bars.length - 1].c : null;
  if (!pivots.length || !finite(close)) return { zones: [], support: null, resistance: null };
  const threshold = Math.max((finite(atr) ? atr : 0) * 0.6, close * 0.003);
  pivots.sort((a, b) => a.price - b.price);
  const zones = [];
  for (const p of pivots) {
    const z = zones[zones.length - 1];
    if (z && Math.abs(p.price - z.mid) <= threshold) {
      z.low = Math.min(z.low, p.price);
      z.high = Math.max(z.high, p.price);
      z.mid = (z.low + z.high) / 2;
      z.touches += 1;
      z.indices.push(p.i);
    } else {
      zones.push({ low: p.price, high: p.price, mid: p.price, touches: 1, indices: [p.i] });
    }
  }
  const scored = zones
    .map((z) => ({ ...z, width: z.high - z.low }))
    .sort((a, b) => b.touches - a.touches || a.width - b.width)
    .slice(0, 8);
  const support =
    scored.filter((z) => z.high < close).sort((a, b) => b.high - a.high)[0] || null;
  const resistance =
    scored.filter((z) => z.low > close).sort((a, b) => a.low - b.low)[0] || null;
  return { zones: scored, support, resistance };
}

/** Return over `sessions` on both legs, with the difference in points. */
export function relativeReturn(bars, benchmark, sessions) {
  if (!bars || !benchmark) return null;
  const byDate = new Map(benchmark.map((b) => [dateOf(b.t), b.c]));
  const pairs = [];
  for (const b of bars) {
    const c = byDate.get(dateOf(b.t));
    if (finite(c) && finite(b.c)) pairs.push([b.c, c]);
  }
  if (pairs.length < sessions + 1) return null;
  const tail = pairs.slice(-(sessions + 1));
  const sym = tail[tail.length - 1][0] / tail[0][0] - 1;
  const bench = tail[tail.length - 1][1] / tail[0][1] - 1;
  return {
    symbol: sym,
    benchmark: bench,
    diff: (sym - bench) * 100,
    sessions,
  };
}

/* -------------------------------------------------------------- range model -- */

function volumeAt(bars, from, to) {
  if (from < 0 || to >= bars.length || from > to) return null;
  return avg(bars.slice(from, to + 1).map((b) => Number(b.v) || 0));
}

/**
 * The one-dimensional volatility score and the next-session range target,
 * computed once per bar. The score at i only uses bars up to i; the target at
 * i uses bar i+1, which is why it can only be a neighbour for a prediction
 * made at t > i.
 */
export function modelSeries(bars) {
  const atr = atrSeries(bars, 14);
  const rv = realizedVolSeries(bars, 20);
  const score = new Array(bars.length).fill(null);
  const targets = new Array(bars.length).fill(null);
  for (let i = 25; i < bars.length; i++) {
    if (!finite(atr[i]) || !finite(rv[i]) || !bars[i].c) continue;
    score[i] =
      0.65 * safeLog(rv[i]) + 0.35 * safeLog(atr[i] / bars[i].c);
  }
  for (let i = 0; i < bars.length - 1; i++) {
    if (bars[i].c > 0) targets[i] = (bars[i + 1].h - bars[i + 1].l) / bars[i].c;
  }
  const sorted = [];
  for (let i = 0; i < score.length; i++) {
    if (finite(score[i]) && finite(targets[i])) sorted.push({ j: i, v: score[i] });
  }
  sorted.sort((a, b) => a.v - b.v || a.j - b.j);
  return { score, targets, atr, rv, sorted };
}

function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].v < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function neighbours(series, t, k = MODEL_NEIGHBOURS, maxHistory = MODEL_MAX_HISTORY) {
  const { score, targets, sorted } = series;
  if (!Number.isInteger(t) || t < 0 || t >= score.length || !finite(score[t])) return null;
  const start = Math.max(0, t - maxHistory);
  const pos = lowerBound(sorted, score[t]);
  let lo = pos - 1;
  let hi = pos;
  const take = [];
  // Walk outward from the current score. Entries outside the eligible prefix
  // (j >= t) and entries older than maxHistory are skipped, but the walk still
  // reaches the k nearest valid sessions because the array is sorted by score.
  while ((lo >= 0 || hi < sorted.length) && take.length < k) {
    const left = lo >= 0 ? Math.abs(sorted[lo].v - score[t]) : Infinity;
    const right = hi < sorted.length ? Math.abs(sorted[hi].v - score[t]) : Infinity;
    const pick = left <= right ? sorted[lo--] : sorted[hi++];
    if (pick.j < start || pick.j >= t) continue;
    if (!finite(targets[pick.j])) continue;
    take.push(targets[pick.j]);
  }
  // Fewer than a third of a normal year is not enough to estimate a percentile
  // tail honestly, so the model declines rather than guessing.
  if (take.length < Math.min(40, k)) return null;
  take.sort((a, b) => a - b);
  return {
    p05: quantileSorted(take, 0.05),
    p10: quantileSorted(take, 0.1),
    p25: quantileSorted(take, 0.25),
    p50: quantileSorted(take, 0.5),
    p75: quantileSorted(take, 0.75),
    p90: quantileSorted(take, 0.9),
    p95: quantileSorted(take, 0.95),
    k: take.length,
    sample: Math.min(t - start, maxHistory),
  };
}

/** One prediction at close t, exposed for tests and for the walk-forward run. */
export function rangePredictionAt(barsOrSeries, t, opts = {}) {
  const series = barsOrSeries.score ? barsOrSeries : modelSeries(barsOrSeries);
  return neighbours(series, t, opts.k, opts.maxHistory);
}

/**
 * The current model plus its walk-forward scorecard.
 *
 * `at` exists for the no-look-ahead test: predicting at bar 299 must produce
 * exactly the same band whether or not bars after 299 exist.
 */
export function computeRangeModel(bars, { at = null, backtestSessions = BACKTEST_SESSIONS } = {}) {
  if (!Array.isArray(bars) || bars.length < MODEL_MIN_BARS) return null;
  const series = modelSeries(bars);
  const last = at == null ? bars.length - 1 : Math.min(at, bars.length - 1);
  const band = neighbours(series, last);
  if (!band) return null;

  const start = Math.max(60, last - backtestSessions);
  let samples = 0;
  let c50 = 0;
  let c80 = 0;
  let c90 = 0;
  const widths = [];
  const errors = [];
  for (let t = start; t < last; t++) {
    const p = neighbours(series, t);
    const actual = series.targets[t];
    if (!p || !finite(actual)) continue;
    samples += 1;
    if (actual >= p.p25 && actual <= p.p75) c50 += 1;
    if (actual >= p.p10 && actual <= p.p90) c80 += 1;
    if (actual >= p.p05 && actual <= p.p95) c90 += 1;
    widths.push(p.p90 - p.p10);
    errors.push(Math.abs(p.p50 - actual));
  }
  if (!samples) return null;

  return {
    method: "k-nearest-neighbour historical range model",
    k: band.k,
    sample: band.sample,
    band: {
      p05: round(band.p05),
      p10: round(band.p10),
      p25: round(band.p25),
      p50: round(band.p50),
      p75: round(band.p75),
      p90: round(band.p90),
      p95: round(band.p95),
    },
    lastRangePct: round(series.targets[last - 1]),
    backtest: {
      sessions: samples,
      coverage: {
        50: round(c50 / samples),
        80: round(c80 / samples),
        90: round(c90 / samples),
      },
      medianWidth: round(median(widths)),
      mae: round(avg(errors)),
    },
  };
}

/* ------------------------------------------------------------------- text -- */

const money = (x) => (finite(x) ? `$${x.toFixed(2)}` : "—");
const pct = (x, digits = 2) => (finite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%` : "—");
const absPct = (x, digits = 2) => (finite(x) ? `${(Math.abs(x) * 100).toFixed(digits)}%` : "—");
const points = (x, digits = 1) => (finite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(digits)} pp` : "—");
const num = (x, digits = 1) => (finite(x) ? x.toFixed(digits) : "—");

export function ordinal(n) {
  if (!finite(n)) return "—";
  const i = Math.round(n);
  const mod100 = i % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
  switch (i % 10) {
    case 1:
      return `${i}st`;
    case 2:
      return `${i}nd`;
    case 3:
      return `${i}rd`;
    default:
      return `${i}th`;
  }
}

function dateLabel(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (!finite(d.getTime())) return String(iso || "the last session");
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function eventLabel(iso) {
  const d = new Date(iso);
  if (!finite(d.getTime())) return "date unavailable";
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " ET"
  );
}

/* ------------------------------------------------------------ symbol brief -- */

function regimeOf({ close, ema20, ema50, adx, efficiency }) {
  if (!finite(close) || !finite(ema20) || !finite(ema50)) return "mixed";
  const above20 = close > ema20;
  const above50 = close > ema50;
  const stackUp = ema20 > ema50;
  if (finite(adx) && adx >= 20 && finite(efficiency) && efficiency >= 0.25 && above20 && above50 && stackUp) {
    return "up trend";
  }
  if (finite(adx) && adx >= 20 && finite(efficiency) && efficiency >= 0.25 && !above20 && !above50 && !stackUp) {
    return "down trend";
  }
  if ((finite(adx) && adx < 18) || (finite(efficiency) && efficiency < 0.18)) return "range";
  return "mixed";
}

function zoneText(zone, side, close) {
  const place = side === "support" ? "below" : "above";
  if (!zone) return `no confirmed ${side} zone ${place} the close in the last 120 sessions`;
  const distance = side === "support" ? (close / zone.high - 1) * 100 : (zone.low / close - 1) * 100;
  return `${money(zone.low)}–${money(zone.high)} (${zone.touches} pivot observation${zone.touches === 1 ? "" : "s"}), ${Math.abs(distance).toFixed(1)}% ${place} the close`;
}

function regimeSentence(regime, { adx, efficiency }) {
  const measured = finite(adx) && finite(efficiency)
    ? `The 14-session ADX is ${num(adx)} and 20-session efficiency is ${num(efficiency, 2)}. `
    : "";
  switch (regime) {
    case "up trend":
      return `${measured}Price is above both the 20- and 50-session averages, and the move has been relatively direct, so the brief labels this an up trend.`;
    case "down trend":
      return `${measured}Price is below both the 20- and 50-session averages, and the move has been relatively direct, so the brief labels this a down trend.`;
    case "range":
      return `${measured}At least one trend reading is too weak for a directional label, so the brief labels this a range rather than a trend.`;
    default:
      return `${measured}The averages and the trend measurements disagree, so the brief labels this mixed rather than forcing a direction.`;
  }
}

function modelSentence(model) {
  if (!model) return "The range model needs at least 80 daily bars; this symbol does not have enough history yet, so no band is shown.";
  const b = model.band;
  const coverage = Math.round(model.backtest.coverage[80] * 100);
  return `The model's 80% band for the next session's high-low range is ${absPct(b.p10)} to ${absPct(b.p90)} of price, with a median of ${absPct(b.p50)}. In the last ${model.backtest.sessions} sessions the same walk-forward method's 80% band contained the actual range ${coverage}% of the time.`;
}

function changeSentence({ close, ema20, high20, low20, regime, volPercentile }) {
  const vol = finite(volPercentile)
    ? ` A volatility percentile above 90 would widen the range band; below 20 would narrow it.`
    : "";
  switch (regime) {
    case "up trend":
      return `A close below the 20-session average (${money(ema20)}) would weaken the up-trend label; a close above the 20-session high (${money(high20)}) would confirm it.${vol}`;
    case "down trend":
      return `A close above the 20-session average (${money(ema20)}) would weaken the down-trend label; a close below the 20-session low (${money(low20)}) would confirm it.${vol}`;
    case "range":
      return `A close above the 20-session high (${money(high20)}) or below the 20-session low (${money(low20)}) would challenge the range label; the trend readings do not currently support a direction.${vol}`;
    default:
      return `A close above the 20-session high (${money(high20)}) or below the 20-session low (${money(low20)}) would challenge the mixed label.${vol}`;
  }
}

function eventSentence(events) {
  if (!events || !events.length) return "No high- or medium-impact USD event is scheduled in the next week.";
  const e = events[0];
  // An absolute date, not "tomorrow": this brief is cached for most of a day,
  // and a relative word can quietly become wrong while the numbers stay right.
  return `The next high- or medium-impact USD event is ${e.title} on ${eventLabel(e.when)} (${e.impact}${e.forecast ? `, forecast ${e.forecast}` : ""}).`;
}

/**
 * Build the symbol research payload. `bars` must be daily, oldest first.
 * `benchmarkBars` is optional; without it the relative-strength block says so.
 */
export function buildSymbolResearch({
  symbol,
  bars,
  benchmarkBars = null,
  benchmarkSymbol = "QQQ",
  events = [],
  source = null,
  asOf = null,
} = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!Array.isArray(bars) || bars.length < MIN_BRIEF_BARS) {
    return {
      available: false,
      symbol: sym,
      sessions: Array.isArray(bars) ? bars.length : 0,
      asOf: asOf || (bars && bars.length ? dateOf(bars[bars.length - 1].t) : null),
      source,
      message: `Not enough daily history for ${sym || "this symbol"}. The brief needs at least ${MIN_BRIEF_BARS} completed sessions; this feed has ${Array.isArray(bars) ? bars.length : 0}.`,
    };
  }

  const last = bars.length - 1;
  const close = bars[last].c;
  const prev = bars[last - 1].c;
  const change = prev > 0 ? close / prev - 1 : null;
  const atr = atrSeries(bars, 14);
  const rv = realizedVolSeries(bars, 20);
  const adx = adxSeries(bars, 14);
  const closes = bars.map((b) => b.c);
  const ema20s = emaSeries(closes, 20);
  const ema50s = emaSeries(closes, 50);
  const ema20 = ema20s[last];
  const ema50 = ema50s[last];
  const atr14 = atr[last];
  const atrPct = finite(atr14) && close > 0 ? atr14 / close : null;
  const rv20 = rv[last];
  const volPercentile = volPercentileAt(rv, last);
  const volPercentile5dAgo = volPercentileAt(rv, last - 5);
  const high20 = Math.max(...bars.slice(-20).map((b) => b.h));
  const low20 = Math.min(...bars.slice(-20).map((b) => b.l));
  const high60 = Math.max(...bars.slice(-60).map((b) => b.h));
  const low60 = Math.min(...bars.slice(-60).map((b) => b.l));
  const drawdown60 = high60 > 0 ? close / high60 - 1 : null;
  const v5 = volumeAt(bars, last - 4, last);
  const v20 = volumeAt(bars, last - 24, last - 5);
  const volumeRatio = v20 && v20 > 0 ? v5 / v20 : null;
  const efficiency = efficiencyAt(bars, last, 20);
  const adx14 = adx[last];
  const regime = regimeOf({ close, ema20, ema50, adx: adx14, efficiency });
  const rs20 = relativeReturn(bars, benchmarkBars, 20);
  const rs60 = relativeReturn(bars, benchmarkBars, 60);
  const levels = pivotZones(bars, { lookback: 120, wing: 3, atr: atr14 });
  const model = computeRangeModel(bars);
  const asOfDate = asOf || dateOf(bars[last].t);
  const upcoming = (Array.isArray(events) ? events : []).slice(0, 5);

  const metrics = {};
  const add = (id, label, value) => {
    metrics[id] = { label, value };
  };
  add("close", "Close", money(close));
  add("change", "1-session change", pct(change));
  add("high20", "20-session high", money(high20));
  add("low20", "20-session low", money(low20));
  add("ema20", "20-session average", money(ema20));
  add("ema50", "50-session average", money(ema50));
  add("adx", "ADX (14)", num(adx14));
  add("efficiency", "Efficiency (20)", num(efficiency, 2));
  add("atr", "ATR (14)", absPct(atrPct));
  add("rv", "Realized volatility (20)", finite(rv20) ? `${(rv20 * 100).toFixed(1)}% annualized` : "—");
  add("volPct", "Volatility percentile", finite(volPercentile) ? ordinal(volPercentile * 100) : "—");
  add("volume", "Volume vs 20-session average", finite(volumeRatio) ? `${volumeRatio.toFixed(2)}×` : "—");
  add("rs20", `Relative to ${benchmarkSymbol} (20 sessions)`, rs20 ? points(rs20.diff) : "—");
  add("rs60", `Relative to ${benchmarkSymbol} (60 sessions)`, rs60 ? points(rs60.diff) : "—");
  add("support", "Nearest support zone", levels.support ? `${money(levels.support.low)}–${money(levels.support.high)}` : "—");
  add("resistance", "Nearest resistance zone", levels.resistance ? `${money(levels.resistance.low)}–${money(levels.resistance.high)}` : "—");
  add("band", "Next-session 80% range band", model ? `${absPct(model.band.p10)}–${absPct(model.band.p90)}` : "—");
  add("coverage", "80% band coverage (walk-forward)", model ? `${Math.round(model.backtest.coverage[80] * 100)}% of ${model.backtest.sessions}` : "—");

  const ev = (...ids) => ids.map((id) => metrics[id]).filter(Boolean);

  const changeClause = finite(change)
    ? `${change >= 0 ? "up" : "down"} ${absPct(change)} from the prior session`
    : "with no usable prior close for a one-session change";
  const stateText = `${sym} closed at ${money(close)} on ${dateLabel(asOfDate)}, ${changeClause}. Price is ${absPct(close / high20 - 1)} below its 20-session high and ${absPct(close / low20 - 1)} above its 20-session low. ${regimeSentence(regime, { adx: adx14, efficiency })}`;

  const riskText = [
    finite(rv20)
      ? `Realized volatility over 20 sessions is ${(rv20 * 100).toFixed(1)}% annualized${finite(volPercentile) ? `, at the ${ordinal(volPercentile * 100)} percentile of the last year` : ""}.`
      : "Realized volatility is unavailable for this window.",
    finite(atrPct) ? `ATR is ${absPct(atrPct)} of price.` : "",
    modelSentence(model),
  ]
    .filter(Boolean)
    .join(" ");

  const supportText = levels.support
    ? `Nearest confirmed support is ${zoneText(levels.support, "support", close)}.`
    : `No confirmed support zone below the close was found in the last 120 sessions.`;
  const resistanceText = levels.resistance
    ? `Nearest confirmed resistance is ${zoneText(levels.resistance, "resistance", close)}.`
    : `No confirmed resistance zone above the close was found in the last 120 sessions.`;
  const levelText = `${supportText} ${resistanceText} Zones are clusters of past turning points, not guaranteed barriers.`;

  const contextParts = [];
  if (rs20) {
    contextParts.push(
      `Over 20 sessions ${sym} returned ${pct(rs20.symbol)} against ${benchmarkSymbol} ${pct(rs20.benchmark)}, a difference of ${points(rs20.diff)}${rs60 ? `; over 60 sessions the difference is ${points(rs60.diff)}` : ""}.`
    );
  } else {
    contextParts.push(`The ${benchmarkSymbol} comparison is unavailable for this symbol.`);
  }
  if (finite(volumeRatio)) {
    contextParts.push(`The last session's volume was ${volumeRatio.toFixed(2)}× its 20-session average.`);
  }
  contextParts.push(eventSentence(upcoming));

  const headline = `${sym}: ${regime}, ${pct(change)} on the session${finite(volPercentile) ? `, volatility at the ${ordinal(volPercentile * 100)} percentile` : ""}.${model ? ` Next-session range band ${absPct(model.band.p10)}–${absPct(model.band.p90)}.` : ""}`;

  const dataGaps = [
    "Daily bars only. This brief does not use intraday prices, futures or after-hours quotes.",
    "Earnings dates, revenue, margins and valuation are not in this feed.",
    "Market news is not attributed to individual symbols in this brief.",
  ];
  if (!benchmarkBars) dataGaps.push(`The ${benchmarkSymbol} series was unavailable, so relative strength is omitted.`);
  if (!finite(volPercentile)) dataGaps.push("A volatility percentile needs at least 60 usable volatility observations; this symbol has fewer.");
  if (!model) dataGaps.push("The range model needs at least 80 daily bars; no band is shown.");
  if (!upcoming.length) dataGaps.push("No scheduled USD event was available from the calendar.");
  if (levels.zones.length === 0) dataGaps.push("No confirmed pivot zone was found in the last 120 sessions.");

  return {
    available: true,
    symbol: sym,
    asOf: asOfDate,
    source,
    delayed: true,
    sessions: bars.length,
    generatedAt: new Date().toISOString(),
    facts: {
      close: round(close),
      change: round(change),
      ema20: round(ema20),
      ema50: round(ema50),
      adx14: round(adx14, 2),
      efficiency20: round(efficiency, 3),
      atrPct: round(atrPct),
      realizedVol20: round(rv20),
      volPercentile: round(volPercentile, 3),
      volPercentile5dAgo: round(volPercentile5dAgo, 3),
      high20: round(high20),
      low20: round(low20),
      high60: round(high60),
      low60: round(low60),
      drawdown60: round(drawdown60),
      volumeRatio20: round(volumeRatio, 2),
      regime,
      relative20: rs20 ? { ...rs20, symbol: round(rs20.symbol), benchmark: round(rs20.benchmark), diff: round(rs20.diff, 2) } : null,
      relative60: rs60 ? { ...rs60, symbol: round(rs60.symbol), benchmark: round(rs60.benchmark), diff: round(rs60.diff, 2) } : null,
      support: levels.support ? { low: round(levels.support.low), high: round(levels.support.high), touches: levels.support.touches, distancePct: round((close / levels.support.high - 1) * 100) } : null,
      resistance: levels.resistance ? { low: round(levels.resistance.low), high: round(levels.resistance.high), touches: levels.resistance.touches, distancePct: round((levels.resistance.low / close - 1) * 100) } : null,
      zones: levels.zones.slice(0, 6).map((z) => ({ low: round(z.low), high: round(z.high), touches: z.touches })),
    },
    brief: {
      headline,
      blocks: [
        { id: "state", title: "Current state", text: stateText, evidence: ev("close", "change", "high20", "low20", "ema20", "ema50", "adx", "efficiency") },
        { id: "risk", title: "Risk and range", text: riskText, evidence: ev("rv", "volPct", "atr", "band", "coverage") },
        { id: "levels", title: "Key levels", text: levelText, evidence: ev("support", "resistance") },
        { id: "context", title: "Context", text: contextParts.join(" "), evidence: ev("rs20", "rs60", "volume") },
        { id: "change", title: "What would change this read", text: changeSentence({ close, ema20, high20, low20, regime, volPercentile }), evidence: ev("ema20", "high20", "low20") },
      ],
      dataGaps,
    },
    model,
    events: upcoming,
    evidence: Object.values(metrics),
  };
}

/* ------------------------------------------------------------- market brief -- */

function marketFacts(series) {
  const bars = series.bars;
  if (!Array.isArray(bars) || bars.length < MIN_BRIEF_BARS) return null;
  const last = bars.length - 1;
  const close = bars[last].c;
  const prev = bars[last - 1].c;
  const closes = bars.map((b) => b.c);
  const ema20s = emaSeries(closes, 20);
  const ema50s = emaSeries(closes, 50);
  const atr = atrSeries(bars, 14);
  const rv = realizedVolSeries(bars, 20);
  const ema20 = ema20s[last];
  const ema50 = ema50s[last];
  const priorIndex = last - 5;
  const prior20 = priorIndex >= 20 ? ema20s[priorIndex] : null;
  return {
    symbol: series.symbol,
    close,
    change: prev > 0 ? close / prev - 1 : null,
    ema20,
    ema50,
    above20: finite(ema20) ? close > ema20 : null,
    above50: finite(ema50) ? close > ema50 : null,
    above20Prev: priorIndex >= 20 && finite(prior20) ? bars[priorIndex].c > prior20 : null,
    atrPct: finite(atr[last]) && close > 0 ? atr[last] / close : null,
    vol20: rv[last],
    volPercentile: volPercentileAt(rv, last),
    volPercentile5dAgo: volPercentileAt(rv, priorIndex),
    high20: Math.max(...bars.slice(-20).map((b) => b.h)),
    low20: Math.min(...bars.slice(-20).map((b) => b.l)),
    asOf: dateOf(bars[last].t),
  };
}

/**
 * Build the market-wide brief from the desk's default daily series. `series` is
 * [{symbol, bars, source}], not the visitor's watchlist: the server cannot see
 * a browser-local list, and pretending otherwise would be a lie in the copy.
 */
export function buildMarketResearch({ series = [], events = [], asOf = null } = {}) {
  const facts = series.map(marketFacts).filter(Boolean);
  if (!facts.length) {
    return { available: false, message: "No daily series were available for the market brief." };
  }
  // The market brief is written around SPY. If SPY is unavailable, building the
  // same sentences around whichever symbol happened to answer would make the
  // copy false, so the brief declines instead of substituting silently.
  const lead = facts.find((f) => f.symbol === "SPY") || null;
  if (!lead) {
    return { available: false, message: "SPY was unavailable, so the market brief was not built." };
  }
  const qqq = facts.find((f) => f.symbol === "QQQ") || null;
  const total = facts.length;
  const above20 = facts.filter((f) => f.above20).length;
  const above50 = facts.filter((f) => f.above50).length;
  const prevKnown = facts.filter((f) => f.above20Prev != null);
  const above20Prev = prevKnown.filter((f) => f.above20Prev).length;
  const leadSeries = series.find((s) => s.symbol === lead.symbol);
  const model = leadSeries ? computeRangeModel(leadSeries.bars) : null;
  const upcoming = (Array.isArray(events) ? events : []).slice(0, 5);
  // The brief is about SPY, so its date must be SPY's date. A newer symbol in
  // the list must not make the market brief claim a session SPY never traded.
  const asOfDate = lead.asOf || asOf;

  const metrics = {};
  const add = (id, label, value) => {
    metrics[id] = { label, value };
  };
  add("spy", "SPY 1-session change", pct(lead.change));
  add("qqq", "QQQ 1-session change", qqq ? pct(qqq.change) : "—");
  add("breadth20", "Above 20-session average", `${above20} of ${total}`);
  add("breadth50", "Above 50-session average", `${above50} of ${total}`);
  add("breadth20Prev", "Above 20-session average, 5 sessions ago", prevKnown.length ? `${above20Prev} of ${prevKnown.length}` : "—");
  add("vol", "SPY realized volatility (20)", finite(lead.vol20) ? `${(lead.vol20 * 100).toFixed(1)}% annualized` : "—");
  add("volPct", "SPY volatility percentile", finite(lead.volPercentile) ? ordinal(lead.volPercentile * 100) : "—");
  add("atr", "SPY ATR (14)", absPct(lead.atrPct));
  add("band", "SPY next-session 80% range band", model ? `${absPct(model.band.p10)}–${absPct(model.band.p90)}` : "—");
  add("coverage", "SPY 80% band coverage", model ? `${Math.round(model.backtest.coverage[80] * 100)}% of ${model.backtest.sessions}` : "—");
  add("support", "SPY 20-session low", money(lead.low20));
  add("resistance", "SPY 20-session high", money(lead.high20));
  const ev = (...ids) => ids.map((id) => metrics[id]).filter(Boolean);

  const breadthLead = above20 === total ? `All ${total}` : above20 === 0 ? "None of the" : `${above20} of the ${total}`;
  const sessionText = `SPY finished ${pct(lead.change)}${qqq ? ` and QQQ finished ${pct(qqq.change)}` : ""} on the session. ${breadthLead} default symbols are above their 20-session average, and ${above50} of ${total} are above their 50-session average.`;
  const riskText = [
    finite(lead.vol20) ? `SPY realized volatility is ${(lead.vol20 * 100).toFixed(1)}% annualized${finite(lead.volPercentile) ? `, at the ${ordinal(lead.volPercentile * 100)} percentile of the last year` : ""}.` : "SPY realized volatility is unavailable.",
    finite(lead.atrPct) ? `ATR is ${absPct(lead.atrPct)} of price.` : "",
    model ? `The model's 80% band for SPY's next-session high-low range is ${absPct(model.band.p10)}–${absPct(model.band.p90)} of price, with ${Math.round(model.backtest.coverage[80] * 100)}% coverage over the last ${model.backtest.sessions} sessions.` : "The range model needs more history for SPY; no band is shown.",
  ].filter(Boolean).join(" ");

  const volMove = finite(lead.volPercentile) && finite(lead.volPercentile5dAgo)
    ? `SPY's volatility percentile is ${ordinal(lead.volPercentile * 100)}, ${lead.volPercentile >= lead.volPercentile5dAgo ? "up" : "down"} from the ${ordinal(lead.volPercentile5dAgo * 100)} percentile five sessions ago.`
    : "The five-session change in SPY's volatility percentile is unavailable.";
  const breadthMove = prevKnown.length
    ? `Breadth is ${above20} of ${total} above their 20-session average, ${above20 === above20Prev ? "unchanged" : above20 > above20Prev ? "up" : "down"} from ${above20Prev} of ${prevKnown.length} five sessions ago.`
    : "";
  const changedText = `${volMove} ${breadthMove}`.trim();

  const breadthHeadline = above20 === total ? `all ${total}` : above20 === 0 ? `none of the ${total}` : `${above20} of ${total}`;
  const headline = `SPY ${pct(lead.change)} on the session; ${breadthHeadline} default symbols above their 20-session average${finite(lead.volPercentile) ? `; volatility at the ${ordinal(lead.volPercentile * 100)} percentile` : ""}.`;
  const changeText = `A close below SPY's 20-session low (${money(lead.low20)}) would weaken the current trend read; a close above the 20-session high (${money(lead.high20)}) would strengthen it.${finite(lead.volPercentile) ? " A volatility percentile above 90 would widen the range band; below 20 would narrow it." : ""}`;

  const dataGaps = [
    "Daily bars only. Breadth is the desk's default list, not your personal watchlist.",
    "Earnings dates, revenue and valuation are not in this feed.",
    "The brief describes the last completed session; it is not a live quote.",
  ];
  if (!qqq) dataGaps.push("QQQ was unavailable, so the index comparison is omitted.");
  if (!model) dataGaps.push("The range model needs more history for SPY.");
  if (!upcoming.length) dataGaps.push("No scheduled USD event was available from the calendar.");

  return {
    available: true,
    asOf: asOfDate,
    leadSymbol: lead.symbol,
    generatedAt: new Date().toISOString(),
    facts: {
      lead: { ...lead, close: round(lead.close), change: round(lead.change), ema20: round(lead.ema20), ema50: round(lead.ema50), atrPct: round(lead.atrPct), vol20: round(lead.vol20), volPercentile: round(lead.volPercentile, 3), high20: round(lead.high20), low20: round(lead.low20) },
      breadth: { above20, above50, total, above20Prev, prevTotal: prevKnown.length },
      symbols: facts.map((f) => ({ symbol: f.symbol, change: round(f.change), above20: f.above20, above50: f.above50 })),
    },
    brief: {
      headline,
      blocks: [
        { id: "session", title: "Session", text: sessionText, evidence: ev("spy", "qqq", "breadth20", "breadth50") },
        { id: "risk", title: "Risk and range", text: riskText, evidence: ev("vol", "volPct", "atr", "band", "coverage") },
        { id: "changed", title: "What changed", text: changedText, evidence: ev("volPct", "breadth20Prev") },
        { id: "calendar", title: "Calendar", text: eventSentence(upcoming), evidence: [] },
        { id: "change", title: "What would change this read", text: changeText, evidence: ev("support", "resistance") },
      ],
      dataGaps,
    },
    model,
    events: upcoming,
    evidence: Object.values(metrics),
  };
}
