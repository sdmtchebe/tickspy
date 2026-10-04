/*
 * Stage-2 bridge test for the browser volatility engine.
 *
 *   node desk/tests/volmodel_stage2.js
 *
 * volmodel.js now splits into buildStage1() -> finish(). volmodel2.js trains the
 * LSTM and calls finish() with its out-of-sample output. This test pins that
 * contract without needing TensorFlow.js:
 *
 *   - finish(stage1, null) must equal the stage-1-only run() the parity harness
 *     checks against the Python model;
 *   - finish(stage1, s2) must fold the LSTM residual into the forecast, the chart
 *     series and the backtest, and must derive the direction metrics and the
 *     stage-2 gate from the numbers it was actually given.
 */
const path = require("path");
const DeskVol = require(path.join(__dirname, "..", "volmodel.js"));
const DeskVol2 = require(path.join(__dirname, "..", "volmodel2.js"));

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
function syntheticBars(n, seed) {
  const rnd = mulberry32(seed);
  const start = Date.UTC(2026, 0, 5, 14, 30, 0);
  const bars = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const vol = i < n / 2 ? 0.0012 : 0.0035;
    const open = close;
    close = open * Math.exp(gaussian(rnd) * vol);
    const high = Math.max(open, close) * (1 + Math.abs(gaussian(rnd)) * 0.0006);
    const low = Math.min(open, close) * (1 - Math.abs(gaussian(rnd)) * 0.0006);
    const day = Math.floor(i / 390);
    const minute = i % 390;
    bars.push({
      t: new Date(start + day * 86400000 + minute * 60000).toISOString(),
      o: open,
      h: high,
      l: low,
      c: close,
      v: 50000 + Math.floor(rnd() * 450000),
    });
  }
  return bars;
}

const failures = { count: 0 };
function ok(label, cond, extra) {
  if (!cond) failures.count++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
}
function close(a, b, tol) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function rmseOf(pred, actual) {
  let s = 0;
  let m = 0;
  for (let i = 0; i < pred.length; i++) {
    if (isFinite(pred[i]) && isFinite(actual[i])) {
      s += (pred[i] - actual[i]) * (pred[i] - actual[i]);
      m++;
    }
  }
  return m ? Math.sqrt(s / m) : NaN;
}

function main() {
  const bars = syntheticBars(900, 3);
  const opts = { symbol: "SYNTH", periodsPerYear: 390 * 252 };
  const st = DeskVol.buildStage1(bars, opts);

  console.log("stage-1 / stage-2 bridge");

  // --- finish(stage1, null) must reproduce the stage-1-only run() ------------
  const viaRun = DeskVol.run(bars, opts);
  const viaFinish = DeskVol.finish(DeskVol.buildStage1(bars, opts), null);
  const same = JSON.stringify(viaRun) === JSON.stringify(viaFinish);
  ok("finish(stage1, null) === run()", same);
  ok("stage 1 exposes no direction", viaFinish.direction_signal === "neutral" && viaFinish.direction_confidence === null);
  ok("stage 1 residual is exactly 0", viaFinish.residual_correction === 0);
  ok(
    "stage-2 warning present when it did not run",
    viaFinish.warnings.some((w) => /Stage 2 \(LSTM\) did not run/.test(w))
  );

  // --- buildStage1 exposes what stage 2 needs --------------------------------
  ok("buildStage1 returns the 5 features per bar", st.feats.length === st.n && st.feats[st.n - 1].length === 5);
  ok("buildStage1 returns direction labels", st.dirs.length === st.n);
  ok("buildStage1 returns usable positions", st.positions.length > 80, `(${st.positions.length})`);
  ok("split matches TEST_FRAC", st.splitPos === Math.floor(st.positions.length * 0.8), `(${st.splitPos}/${st.positions.length})`);

  // --- a synthetic stage-2 result --------------------------------------------
  const resByPos = {};
  const dirByPos = {};
  // A deliberately decent residual estimate: half the true stage-1 error.
  for (const p of st.testPos) {
    const err = st.rv[p] - st.lin[p];
    if (isFinite(err)) resByPos[p] = 0.5 * err;
    dirByPos[p] = st.dirs[p];
  }
  const out = DeskVol.finish(DeskVol.buildStage1(bars, opts), {
    resByPos,
    dirByPos,
    residual: 0.01,
    rawResidual: 0.02,
    stage2Weight: 0.5,
    direction: "bullish",
    confidence: 0.61,
    folds: 3,
    strict: true,
  });

  ok("forecast moves by the gated residual", close(out.predicted_volatility, out.linear_volatility + 0.01, 1e-6), `(${out.linear_volatility} + 0.01 = ${out.predicted_volatility})`);
  ok("residual reported separately", out.residual_correction === 0.01 && out.lstm_raw_residual === 0.02);
  ok("stage-2 weight reported", out.stage2_weight === 0.5);
  ok("direction and confidence carried through", out.direction_signal === "bullish" && out.direction_confidence === 0.61);
  ok("model label names the LSTM", /LSTM/.test(out.model), out.model);
  ok("engine marks the tfjs path", out.engine === "browser-js-tfjs");
  ok("fold count and strict flag carried through", out.backtest.folds === 3 && out.strict === true);

  // --- the backtest must use the LSTM residual -------------------------------
  const linT = st.testPos.map((p) => st.lin[p]);
  const combT = st.testPos.map((p) => st.lin[p] + (resByPos[p] || 0));
  const rvT = st.testPos.map((p) => st.rv[p]);
  const wantRmseComb = rmseOf(combT, rvT);
  const wantVsLinear = 100 * (1 - wantRmseComb / rmseOf(linT, rvT));
  ok("combined RMSE includes the residual", close(out.backtest.vol_rmse_combined, wantRmseComb, 1e-9));
  ok("combined vs stage 1 matches a manual RMSE", close(out.backtest.combined_vs_linear_pct, wantVsLinear, 1e-9), `(${out.backtest.combined_vs_linear_pct})`);

  // Direction metrics: we fed it the true labels, so both must be perfect.
  ok("direction hit rate computed", out.backtest.direction_accuracy === 1, `(${out.backtest.direction_accuracy})`);
  ok("balanced accuracy computed", out.backtest.direction_balanced_accuracy === 1);
  ok("direction edge derived from balanced accuracy", out.direction_edge === "usable", out.direction_edge);
  ok("direction distribution reported", Array.isArray(out.backtest.direction_pred_dist) && out.backtest.direction_pred_dist.length === 3);

  // --- the chart series must add the residual --------------------------------
  const n = out.series.combined.length;
  const tail = st.testPos.slice().sort((a, b) => a - b).slice(-160);
  let seriesOk = n === tail.length;
  for (let i = 0; i < n && seriesOk; i++) {
    const want = st.lin[tail[i]] + (resByPos[tail[i]] || 0);
    if (!close(out.series.combined[i], want, 1e-5)) seriesOk = false;
  }
  ok("chart series adds the residual", seriesOk);

  // --- random direction calls must score near chance, not be flattered ------
  const rnd = mulberry32(99);
  const noiseDir = {};
  for (const p of st.testPos) noiseDir[p] = Math.floor(rnd() * 3);
  const noise = DeskVol.finish(DeskVol.buildStage1(bars, opts), {
    resByPos,
    dirByPos: noiseDir,
    residual: 0,
    rawResidual: 0,
    stage2Weight: 0,
    direction: "neutral",
    confidence: null,
    folds: 1,
    strict: false,
  });
  ok("random direction calls are not called usable", noise.direction_edge !== "usable", `(bal ${noise.backtest.direction_balanced_accuracy})`);

  // --- scaler / sequence helpers ---------------------------------------------
  // The first row has a NaN, so sklearn's RobustScaler would fit on the other
  // three rows: column 0 -> [2,3,4] (median 3, IQR 1), column 2 -> [5,5,5].
  const feats = [[1, 10, NaN], [2, 20, 5], [3, 30, 5], [4, 40, 5]];
  const sc = DeskVol2._internal.fitScaler(feats);
  ok("RobustScaler fits only complete rows", sc.center[0] === 3, `(centre ${sc.center[0]})`);
  ok("RobustScaler scales by the IQR", Math.abs(sc.scale[0] - 1) < 1e-12, `(scale ${sc.scale[0]})`);
  ok("zero-spread column falls back to scale 1", sc.scale[2] === 1);
  const xs = DeskVol2._internal.transformAll(feats, sc);
  // row 0 = [1,10,NaN] -> cleaned to [1,10,0] -> [(1-3)/1, (10-30)/10, (0-5)/1]
  ok("NaN is cleaned to 0, then scaled", xs[0][2] === -5, `(${xs[0][2]})`);
  ok("complete rows transform to their z-robust score", xs[2][0] === 0 && xs[2][1] === 0, `(${xs[2][0]}, ${xs[2][1]})`);
  const capped = DeskVol2._internal.capEven([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
  ok("capEven keeps the requested count and the endpoints", capped.length === 5 && capped[0] === 0 && capped[4] === 9, JSON.stringify(capped));

  console.log(failures.count ? `\n${failures.count} check(s) FAILED` : "\nall checks passed");
  process.exit(failures.count ? 1 : 0);
}

main();
