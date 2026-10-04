// Demo simulation of the TickSPY two-stage volatility pipeline.
// Stage 1: Garman-Klass realized vol -> HAR(1,5,22) walk-forward (+ GARCH(1,1) cross-check) -> residuals.
// Stage 2: LSTM residual correction + direction logits, auto-gated by out-of-sample RMSE gain.
export const STAGE2_FULL_IMPROVE = 5.0; // % OOS RMSE gain at which the LSTM correction is applied in full
export const CAP = 0.5; // correction capped at +/-50% of the linear forecast

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

export function harForecast(rv) {
  const n = rv.length;
  const d = rv[n - 1];
  const w = mean(rv.slice(-5));
  const m = mean(rv.slice(-22));
  return 0.04 + 0.34 * d + 0.36 * w + 0.26 * m;
}

export function createVolModel(seedLen = 48) {
  const rv = [];
  let level = 0.92;
  for (let i = 0; i < seedLen; i++) {
    level = 0.9 + 0.82 * (level - 0.9) + (Math.random() - 0.5) * 0.22;
    rv.push(Math.max(0.3, level + (i % 13 === 0 ? 0.35 : 0)));
  }
  const har = [];
  const corrected = [];
  const resid = [];
  for (let i = 22; i < rv.length; i++) {
    const h = harForecast(rv.slice(0, i));
    har.push(h);
    resid.push(rv[i] - h);
    corrected.push(h);
  }
  let oosGain = 3.4;
  let logits = [-0.2, 0.3, 0.1];
  const rmse = 0.14;

  const step = () => {
    level = 0.9 + 0.82 * (level - 0.9) + (Math.random() - 0.5) * 0.22;
    const spike = Math.random() < 0.07 ? 0.4 : 0;
    const next = Math.max(0.3, level + spike);
    const h = harForecast(rv);
    // LSTM predicts the next residual as a damped reversal of the last ones, scaled by the gate
    const lastE = mean(resid.slice(-3));
    oosGain = Math.min(6.5, Math.max(0.8, oosGain + (Math.random() - 0.5) * 0.5));
    const gate = Math.min(1, oosGain / STAGE2_FULL_IMPROVE);
    const rawDelta = (-0.55 * lastE + (Math.random() - 0.5) * 0.06) * gate;
    const delta = Math.max(-CAP * h, Math.min(CAP * h, rawDelta));
    const garch = h * (1 + (Math.random() - 0.5) * 0.08);
    logits = logits.map((l, i) => 0.7 * l + (Math.random() - 0.5) * 0.6 + (i === 2 && delta < 0 ? 0.15 : 0));
    const ex = logits.map(Math.exp);
    const z = ex.reduce((a, b) => a + b, 0);
    const probs = ex.map((v) => v / z);

    rv.push(next);
    har.push(h);
    corrected.push(h + delta);
    resid.push(next - h);
    if (rv.length > 80) { rv.shift(); har.shift(); corrected.shift(); resid.shift(); }

    return {
      rv: [...rv], har: [...har], corrected: [...corrected], resid: [...resid],
      linear: h, garch, delta, forecast: h + delta, gate, oosGain, rmse, probs,
      masked: Math.random() < 0.12, quality: Math.random() > 0.05,
    };
  };
  return { step };
}
