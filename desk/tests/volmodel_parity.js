/*
 * Parity check for the browser volatility engine (../volmodel.js).
 *
 * Generates deterministic OHLCV series, feeds the *same* bars to the Python
 * model and to the browser engine, and compares the stage-1 numbers.
 *
 *   node desk/tests/volmodel_parity.js
 *
 * Exits non-zero if any checked value drifts outside its tolerance, so this can
 * be used as a guard whenever either implementation changes.
 *
 * Shape-level fields (HAR, RMSE, sample counts, neutral band) reproduce the
 * Python model to machine precision. GARCH is an independently-converged MLE:
 * arch's SLSQP plus its backcast convention cannot be ported exactly, so its
 * tolerance is loose and deliberately documented.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DeskVol = require(path.join(__dirname, "..", "volmodel.js"));

const SEEDS = [3, 11];

// ------------------------------------------------------------------ helpers --
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 3 trading sessions of 1-minute bars, two volatility regimes. Timestamps are
// emitted as UTC instants for 09:30 ET so session-boundary handling is exercised.
function syntheticBars(n, seed) {
  const rnd = mulberry32(seed);
  const start = Date.UTC(2026, 0, 5, 14, 30, 0); // Mon 2026-01-05 09:30 ET (EST)
  const bars = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const vol = i < n / 2 ? 0.0012 : 0.0035;
    const ret = gaussian(rnd) * vol;
    const open = close;
    close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(gaussian(rnd)) * 0.0006);
    const low = Math.min(open, close) * (1 - Math.abs(gaussian(rnd)) * 0.0006);
    const day = Math.floor(i / 390);
    const minute = i % 390;
    const ms = start + day * 86400000 + minute * 60000;
    bars.push({
      t: new Date(ms).toISOString(),
      o: open,
      h: high,
      l: low,
      c: close,
      v: 50000 + Math.floor(rnd() * 450000),
    });
  }
  return bars;
}

// vol_percentile is intentionally not compared: it is derived from the final
// forecast, which on the Python side includes the stage-2 residual that simply
// does not exist in the browser build.
const CHECKS = [
  ["linear_volatility", "HAR next-bar forecast", 1e-3],
  ["garch_volatility", "GARCH cross-check (approx.)", 5e-2],
  ["current_volatility", "latest realized GK vol", 1e-9],
];
const BT_CHECKS = [
  ["samples", "out-of-sample bar count", 0],
  ["vol_rmse_linear", "HAR RMSE", 1e-3],
  ["vol_rmse_persistence", "persistence RMSE", 1e-3],
  ["direction_threshold_pct", "neutral band", 1e-9],
];

function relDiff(a, b) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return NaN;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale;
}

const fmt = (x) => (x == null || !isFinite(x) ? "--" : Number(x).toPrecision(7));

function checkSeed(seed, failures) {
  const bars = syntheticBars(900, seed);
  const tmp = process.env.DESK_BARS_OUT || path.join(os.tmpdir(), `desk_bars_${seed}.json`);
  fs.writeFileSync(tmp, JSON.stringify(bars));

  const js = DeskVol.run(bars, { symbol: "SYNTH", periodsPerYear: 390 * 252 });
  const py = JSON.parse(
    execFileSync("python3", [path.join(__dirname, "volmodel_parity.py"), tmp], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    })
  );

  console.log(`\nseed ${seed}: js bars=${js.bars}  py bars=${py.bars}`);
  const row = (label, a, b, tol) => {
    const d = relDiff(a, b);
    const ok = isFinite(d) ? d <= tol : a === b;
    if (!ok) failures.count++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label.padEnd(30)} js=${fmt(a).padStart(12)}  py=${fmt(b).padStart(12)}  rel=${isFinite(d) ? d.toExponential(2) : "n/a"}`
    );
  };

  for (const [key, label, tol] of CHECKS) row(label, js[key], py[key], tol);
  for (const [key, label, tol] of BT_CHECKS) row(label, js.backtest[key], py.backtest[key], tol);

  const regimeOk = js.regime === py.regime;
  if (!regimeOk) failures.count++;
  console.log(`  ${regimeOk ? "ok  " : "FAIL"} ${"regime".padEnd(30)} js="${js.regime}"  py="${py.regime}"`);

  const seriesOk = js.series.realized.length === py.series_len;
  if (!seriesOk) failures.count++;
  console.log(
    `  ${seriesOk ? "ok  " : "FAIL"} ${"series points".padEnd(30)} js=${js.series.realized.length}  py=${py.series_len}`
  );

  console.log(
    `  info stage-2 weight (py only) = ${fmt(py.pct_stage2_weight)}  (browser build is stage 1 only)`
  );
}

function main() {
  const failures = { count: 0 };
  console.log("browser volatility engine vs Python model");
  for (const seed of SEEDS) checkSeed(seed, failures);
  console.log(failures.count ? `\n${failures.count} check(s) FAILED` : "\nall checks passed");
  process.exit(failures.count ? 1 : 0);
}

main();
