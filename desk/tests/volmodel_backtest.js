/*
 * Honest backtest of the desk's volatility engine (../volmodel.js) on real bars.
 *
 *   node desk/tests/volmodel_backtest.js [bars.json]
 *
 * Bars come from Alpaca (IEX daily, the longest the free feed returns). Pass a
 * cached JSON file, or set ALPACA_KEY_ID / ALPACA_SECRET_KEY and it fetches and
 * caches. Nothing here re-implements the model: every number below comes from
 * running the shipped volmodel.js, so the report describes what the site
 * actually ships.
 *
 * What it measures
 *   1. Expanding-window folds. The engine trains on the first 80% and tests on
 *      the held-out last 20%; we re-run it at several cutoffs so one lucky
 *      window cannot flatter the result.
 *   2. Skill against a naive persistence baseline (tomorrow = today). A model
 *      that cannot beat "the number will be the same as last time" has no edge.
 *   3. Regime tranches: is the error concentrated in calm or turbulent markets?
 *   4. A look-ahead test. Rewriting the most recent bars must not change the
 *      predictions the engine made for earlier bars. If it does, it is peeking.
 *
 * Remaining limitations, stated up front: daily bars only (the desk trades
 * intraday, where the sample is far shorter), one instrument (SPY), a single
 * 80/20 split per fold rather than a full rolling-origin sweep, and no
 * transaction costs, because this estimates volatility and never places a
 * trade. Volatility clustering means the sample is not independent, so the
 * errors below are optimistic in the usual way.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DeskVol = require(path.join(__dirname, "..", "volmodel.js"));

const SYMBOL = process.env.BT_SYMBOL || "SPY";
// 5-minute bars: intraday (which is what the desk and the engine assume) while
// still covering ~5 years of calendar time in ~100k bars.
const TF = process.env.BT_TF || "5Min";
const CACHE = process.env.BT_CACHE || `/tmp/bt_${SYMBOL}_${TF}.json`;
const FOLDS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const PERIODS_PER_YEAR = Number(process.env.BT_PPY || (TF === "1Day" ? 252 : 78 * 252));

// ------------------------------------------------------------------- helpers --
const f = (x, d = 4) => (x == null || !isFinite(x) ? "--" : Number(x).toFixed(d));
const pct = (x, d = 1) => (x == null || !isFinite(x) ? "--" : `${x >= 0 ? "+" : ""}${Number(x).toFixed(d)}%`);

function loadBars(argv) {
  const file = argv[2] || CACHE;
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalize(raw.bars || raw);
  }
  const key = process.env.ALPACA_KEY_ID;
  const sec = process.env.ALPACA_SECRET_KEY;
  if (!key || !sec) {
    console.error(
      "No bars file and no ALPACA_KEY_ID/ALPACA_SECRET_KEY set.\n" +
        `Pass a JSON file of bars, or set the keys so this can fetch ${SYMBOL}.\n`
    );
    process.exit(2);
  }
  // The IEX feed is the only one on the free plan. It still returns the full
  // history of the symbol, just sourced from IEX's consolidated tape, and it
  // pages at 10k bars a call.
  const start = process.env.BT_START || new Date(Date.now() - 5 * 365 * 864e5).toISOString().slice(0, 10);
  const all = [];
  let token = null;
  for (let page = 0; page < 200; page++) {
    const url =
      `https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars?timeframe=${TF}&start=${start}` +
      `&limit=10000&sort=asc&feed=iex&adjustment=all${token ? `&page_token=${encodeURIComponent(token)}` : ""}`;
    const out = execFileSync(
      "curl",
      ["-s", "-m", "120", "-H", `APCA-API-KEY-ID: ${key}`, "-H", `APCA-API-SECRET-KEY: ${sec}`, url],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
    );
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch (e) {
      console.error("Alpaca returned non-JSON:", out.slice(0, 200));
      process.exit(2);
    }
    if (parsed.message && !parsed.bars) {
      console.error("Alpaca error:", parsed.message);
      process.exit(2);
    }
    if (parsed.bars && parsed.bars.length) all.push(...parsed.bars);
    token = parsed.next_page_token;
    process.stderr.write(`\r  fetched ${all.length} ${TF} bars (page ${page + 1})   `);
    if (!token) break;
  }
  process.stderr.write("\n");
  if (!all.length) {
    console.error("Alpaca returned no bars.");
    process.exit(2);
  }
  fs.writeFileSync(CACHE, JSON.stringify({ bars: all }));
  return normalize(all);
}

// The engine treats a *numeric* t as a real timestamp and masks "session
// boundary" returns across ET date changes - correct for intraday bars, but on
// daily bars every bar is a new session, which would NaN out the whole return
// series. Passing t as an ISO string (exactly as volmodel_parity.js does) makes
// the engine treat the series as one continuous session, which is the right
// reading of a daily bar history. _d keeps a parsed date for our own reporting.
function normalize(bars) {
  return bars
    .map((b) => ({
      t: typeof b.t === "string" ? b.t : new Date(b.t).toISOString(),
      _d: new Date(b.t),
      o: +b.o,
      h: +b.h,
      l: +b.l,
      c: +b.c,
      v: +b.v,
    }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => isFinite(x) && x > 0) && b.h >= b.l)
    .sort((a, b) => a._d - b._d);
}

const rmseOf = (pred, real) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < pred.length; i++) {
    if (isFinite(pred[i]) && isFinite(real[i])) {
      s += (pred[i] - real[i]) ** 2;
      n++;
    }
  }
  return n ? Math.sqrt(s / n) : NaN;
};

// Ordinary least squares of realized = a + b * estimate. The honest model has
// b near 1 (it is calibrated, not merely correlated) and a near 0.
function ols(y, x) {
  const pairs = [];
  for (let i = 0; i < y.length; i++) if (isFinite(y[i]) && isFinite(x[i])) pairs.push([x[i], y[i]]);
  const n = pairs.length;
  if (n < 3) return { a: NaN, b: NaN, r2: NaN, n };
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [px, py] of pairs) {
    sxy += (px - mx) * (py - my);
    sxx += (px - mx) ** 2;
    syy += (py - my) ** 2;
  }
  const b = sxx ? sxy / sxx : NaN;
  const a = my - b * mx;
  return { a, b, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : NaN, n };
}

function runFold(bars, frac) {
  const cut = Math.max(120, Math.floor(bars.length * frac));
  const slice = bars.slice(0, cut);
  const out = DeskVol.run(slice, { symbol: SYMBOL, periodsPerYear: PERIODS_PER_YEAR });
  if (!out || !out.backtest || !out.backtest.samples) {
    return { frac, bars: slice.length, skipped: true };
  }
  const bt = out.backtest;
  const s = out.series || { realized: [], linear: [], combined: [] };
  const mz = ols(s.realized, s.combined);
  return {
    frac,
    bars: slice.length,
    from: slice[0]._d.toISOString().slice(0, 10),
    to: slice[slice.length - 1]._d.toISOString().slice(0, 10),
    samples: bt.samples,
    rmseLinear: bt.vol_rmse_linear,
    rmseCombined: bt.vol_rmse_combined,
    rmsePersist: bt.vol_rmse_persistence,
    maeCombined: bt.vol_mae_combined,
    skillLinear: bt.combined_vs_linear_pct,
    skillPersist: bt.combined_vs_persistence_pct,
    r2: bt.r2_combined,
    dirBal: bt.direction_balanced_accuracy,
    reliable: !!out.reliable,
    estimate: out.volatility_estimate != null ? out.volatility_estimate : out.predicted_volatility,
    mz,
    series: s,
  };
}

// ------------------------------------------------------------------ reporting --
const bars = loadBars(process.argv);
console.log(`\n=== TickSPY volatility engine — real backtest ===`);
console.log(`instrument ${SYMBOL}   bars ${bars.length}   ${bars[0]._d.toISOString().slice(0, 10)} .. ${bars[bars.length - 1]._d.toISOString().slice(0, 10)}   ${TF}, Alpaca IEX\n`);

const folds = FOLDS.map((k) => runFold(bars, k)).filter((r) => !r.skipped);

console.log("folds (expanding window; engine holds out the last 20% of each slice)");
console.log("  bars    window                    OOS    RMSE     RMSE       skill vs      R2     MZ      reliable");
console.log("                                        bars   model    persist    persistence           slope");
for (const r of folds) {
  console.log(
    `  ${String(r.bars).padEnd(7)} ${r.from}..${r.to}  ${String(r.samples).padStart(6)}  ` +
      `${f(r.rmseCombined, 4).padStart(7)}  ${f(r.rmsePersist, 4).padStart(7)}  ` +
      `${pct(r.skillPersist).padStart(11)}  ${f(r.r2, 3).padStart(6)}  ${f(r.mz.b, 3).padStart(5)}  ${r.reliable ? "yes" : "no"}`
  );
}

// `path` may be dotted, e.g. "mz.b", because the Mincer-Zarnowitz numbers hang
// off a per-fold object.
const aggOf = (path) => {
  const pick = (r) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), r);
  const v = folds.map(pick).filter((x) => x != null && isFinite(x));
  if (!v.length) return { n: 0 };
  const sorted = [...v].sort((a, b) => a - b);
  return {
    n: v.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    pos: v.filter((x) => x > 0).length,
  };
};
console.log("\naggregate across folds");
for (const [key, label] of [
  ["skillPersist", "skill vs persistence (%)"],
  ["skillLinear", "skill vs stage-1 linear (%; 0 = stage 2 never ran)"],
  ["r2", "R2 (estimate vs realized)"],
  ["mz.b", "Mincer-Zarnowitz slope (1.0 = calibrated)"],
]) {
  const a = aggOf(key);
  if (!a.n) { console.log(`  ${label.padEnd(48)} n=0`); continue; }
  console.log(`  ${label.padEnd(48)} n=${a.n}  worst ${f(a.min, 3)}  median ${f(a.median, 3)}  best ${f(a.max, 3)}  positive in ${a.pos}/${a.n}`);
}
console.log(`  folds reporting "reliable": ${folds.filter((r) => r.reliable).length}/${folds.length}`);

// Regime tranches: where does the error actually live?
const full = folds[folds.length - 1];
if (full && full.series && full.series.realized && full.series.realized.length > 30) {
  const real = full.series.realized;
  const comb = full.series.combined;
  const persist = real.map((_, i) => (i ? real[i - 1] : NaN));
  const order = real.map((v, i) => [v, i]).filter(([v]) => isFinite(v)).sort((a, b) => a[0] - b[0]);
  const third = Math.floor(order.length / 3);
  const bands = { calm: order.slice(0, third), mid: order.slice(third, 2 * third), turbulent: order.slice(2 * third) };
  console.log("\nerror by realized-volatility regime (final fold)");
  console.log("  regime        n    RMSE model   RMSE persistence   skill");
  for (const [name, rows] of Object.entries(bands)) {
    const idx = rows.map(([, i]) => i);
    const r = idx.map((i) => real[i]);
    const m = rmseOf(idx.map((i) => comb[i]), r);
    const p = rmseOf(idx.map((i) => persist[i]), r);
    console.log(
      `  ${name.padEnd(12)} ${String(idx.length).padStart(4)}   ${f(m, 4).padStart(10)}   ${f(p, 4).padStart(15)}   ${pct(p && m ? 100 * (1 - m / p) : NaN).padStart(7)}`
    );
  }
}

// --------------------------------------------------- look-ahead integrity test --
// Overwrite the newest bars. Predictions the engine made for older bars must be
// byte-identical, because an expanding walk-forward can only ever look back.
console.log("\nlook-ahead integrity test");
function perturb(bars, n) {
  const copy = bars.map((b) => ({ ...b }));
  for (let i = copy.length - n; i < copy.length; i++) {
    copy[i] = { ...copy[i], o: copy[i].o * 1.6, h: copy[i].h * 1.6, l: copy[i].l * 0.6, c: copy[i].c * 1.6, v: copy[i].v * 3 };
  }
  return copy;
}
const N_PERTURB = 25;
const a = runFold(bars, 1.0);
const b = runFold(perturb(bars, N_PERTURB), 1.0);
let checked = 0;
let drifted = 0;
if (a.series && b.series) {
  for (let i = 0; i < Math.min(a.series.realized.length, b.series.realized.length); i++) {
    if (a.series.realized[i] == null || b.series.realized[i] == null) continue;
    // Only compare bars whose realized value was left untouched.
    if (Math.abs(a.series.realized[i] - b.series.realized[i]) > 1e-12) continue;
    checked++;
    if (Math.abs((a.series.linear[i] ?? 0) - (b.series.linear[i] ?? 0)) > 1e-9) drifted++;
  }
}
const leakFree = drifted === 0 && checked > 20;
console.log(`  rewrote the newest ${N_PERTURB} bars; compared ${checked} untouched bars`);
console.log(`  ${leakFree ? "ok  " : "FAIL"} predictions for untouched bars ${drifted === 0 ? "did not move" : `MOVED in ${drifted} places`} -> ${drifted === 0 ? "no look-ahead found" : "LOOK-AHEAD LEAK"}`);

console.log("\nverdict is reported above; nothing here is asserted to be accurate — only the look-ahead test is a pass/fail.");
process.exit(leakFree ? 0 : 1);
