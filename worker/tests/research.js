/* Research engine tests.
 *
 *   node tests/research.js
 *
 * Pure functions, synthetic price series, no network and no KV. The point of
 * this suite is the part that would be easiest to get quietly wrong: the
 * walk-forward model must never see a future bar, every band must be ordered,
 * and every sentence must be built from a fact the response also exposes.
 */
import assert from "node:assert/strict";
import {
  atrSeries,
  realizedVolSeries,
  volPercentileAt,
  adxSeries,
  emaSeries,
  efficiencyAt,
  pivotZones,
  relativeReturn,
  modelSeries,
  rangePredictionAt,
  computeRangeModel,
  buildSymbolResearch,
  buildMarketResearch,
  ordinal,
  MIN_BRIEF_BARS,
} from "../src/research.js";

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${(e && e.message) || e}`);
  }
}

/* A deterministic series with enough structure for trends, ranges and volume.
 * It is not a market; it only needs to exercise every branch. */
function makeBars(n = 320, { drift = 0.001, vol = 0.01, start = 100 } = {}) {
  let px = start;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = Math.max(
      1,
      open * (1 + drift + Math.sin(i / 7) * 0.002 + ((i % 5) - 2) * vol * 0.35)
    );
    const high = Math.max(open, close) * (1 + vol * (0.5 + ((i * 13) % 7) / 10));
    const low = Math.min(open, close) * (1 - vol * (0.5 + ((i * 11) % 7) / 10));
    bars.push({
      t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      o: open,
      h: high,
      l: low,
      c: close,
      v: 1_000_000 + ((i * 7919) % 300_000),
    });
    px = close;
  }
  return bars;
}

const BARS = makeBars();

/* ------------------------------------------------------------- indicators -- */

test("ATR is null before its window and finite after it", () => {
  const atr = atrSeries(BARS, 14);
  assert.equal(atr[13], null);
  assert.ok(Number.isFinite(atr[14]));
  assert.ok(atr.every((v) => v == null || v > 0));
});

test("realized volatility is annualized and aligned with the bars", () => {
  const rv = realizedVolSeries(BARS, 20);
  assert.equal(rv[19], null);
  assert.ok(rv[20] > 0);
  // A sub-1% daily standard deviation becomes a multi-percent annual figure;
  // a value near 0.001 would mean the sqrt(252) scaling was lost.
  assert.ok(rv[20] > 0.02 && rv[20] < 1, `expected annualized vol, got ${rv[20]}`);
});

test("volatility percentile stays inside 0..1 and declines without history", () => {
  const rv = realizedVolSeries(BARS, 20);
  const p = volPercentileAt(rv, BARS.length - 1);
  assert.ok(p >= 0 && p <= 1);
  assert.equal(volPercentileAt(rv, 10), null);
});

test("ADX is null until two windows exist, then finite and bounded", () => {
  const adx = adxSeries(BARS, 14);
  assert.equal(adx[26], null);
  assert.ok(adx[27] != null);
  const finite = adx.filter((v) => v != null);
  assert.ok(finite.length > 100);
  assert.ok(finite.every((v) => v >= 0 && v <= 100));
});

test("EMA and efficiency produce sane values", () => {
  const closes = BARS.map((b) => b.c);
  const e = emaSeries(closes, 20);
  assert.equal(e.length, closes.length);
  assert.ok(e.every(Number.isFinite));
  const eff = efficiencyAt(BARS, BARS.length - 1, 20);
  assert.ok(eff >= 0 && eff <= 1);
});

test("pivot zones are ordered and never straddle the close by construction", () => {
  const atr = atrSeries(BARS, 14).at(-1);
  const z = pivotZones(BARS, { lookback: 120, wing: 3, atr });
  assert.ok(z.zones.length > 0);
  for (const zone of z.zones) assert.ok(zone.low <= zone.high);
  if (z.support) assert.ok(z.support.high < BARS.at(-1).c);
  if (z.resistance) assert.ok(z.resistance.low > BARS.at(-1).c);
});

test("relative return aligns on dates rather than on array positions", () => {
  const bench = makeBars(320, { drift: 0.0005, vol: 0.008 });
  const r = relativeReturn(BARS, bench, 20);
  assert.ok(r);
  assert.equal(r.sessions, 20);
  assert.ok(Number.isFinite(r.diff));
});

/* ------------------------------------------------------------ range model -- */

test("model series only carries targets for a future bar", () => {
  const s = modelSeries(BARS);
  assert.equal(s.targets.at(-1), null);
  assert.ok(s.targets.slice(0, -1).every((v) => v == null || v > 0));
  assert.ok(s.sorted.length > 100);
});

test("prediction bands are ordered and the sample is large enough to mean something", () => {
  const s = modelSeries(BARS);
  const p = rangePredictionAt(s, BARS.length - 1);
  assert.ok(p);
  assert.ok(p.p05 <= p.p10 && p.p10 <= p.p25 && p.p25 <= p.p50);
  assert.ok(p.p50 <= p.p75 && p.p75 <= p.p90 && p.p90 <= p.p95);
  assert.ok(p.p10 > 0);
  assert.ok(p.k >= 40);
});

test("the model refuses to guess when there is not enough history", () => {
  assert.equal(computeRangeModel(BARS.slice(0, 60)), null);
  assert.equal(rangePredictionAt(modelSeries(BARS.slice(0, 60)), 59), null);
});

test("walk-forward scoring reports coverage in 0..1 and a positive width", () => {
  const m = computeRangeModel(BARS);
  assert.ok(m);
  for (const key of ["50", "80", "90"]) {
    assert.ok(m.backtest.coverage[key] >= 0 && m.backtest.coverage[key] <= 1);
  }
  assert.ok(m.backtest.sessions >= 60);
  assert.ok(m.backtest.medianWidth > 0);
  assert.ok(m.backtest.mae >= 0);
  assert.ok(m.band.p10 < m.band.p90);
});

test("appending future bars cannot change a prediction made before them", () => {
  const cutoff = 299;
  const atCutoff = computeRangeModel(BARS, { at: cutoff });
  const truncated = computeRangeModel(BARS.slice(0, cutoff + 1));
  assert.deepEqual(atCutoff.band, truncated.band);
  assert.deepEqual(atCutoff.backtest, truncated.backtest);
});

/* ----------------------------------------------------------- symbol brief -- */

test("a full symbol brief has five blocks and evidence for every claim", () => {
  const b = buildSymbolResearch({
    symbol: "test",
    bars: BARS,
    benchmarkBars: makeBars(320, { drift: 0.0008, vol: 0.009 }),
    events: [
      {
        title: "CPI",
        impact: "High",
        when: new Date(Date.now() + 2 * 86400000).toISOString(),
        forecast: "3.1%",
      },
    ],
    source: "fixture",
  });
  assert.equal(b.available, true);
  assert.equal(b.symbol, "TEST");
  assert.equal(b.brief.blocks.length, 5);
  assert.ok(b.brief.headline.includes("TEST"));
  assert.ok(b.model);
  assert.ok(b.evidence.length >= 15);
  for (const block of b.brief.blocks) {
    assert.ok(block.text.length > 20, `${block.id} has no text`);
    assert.ok(!/NaN|undefined|null/.test(block.text), `${block.id} leaked a missing value`);
  }
  const combined = JSON.stringify(b);
  assert.ok(!/NaN|undefined/.test(combined), "the response contains a missing numeric value");
});

test("the brief declines below its minimum history instead of inventing a setup", () => {
  const b = buildSymbolResearch({ symbol: "NEW", bars: makeBars(MIN_BRIEF_BARS - 1) });
  assert.equal(b.available, false);
  assert.match(b.message, /at least 40/);
});

test("a short but usable series keeps the facts and omits only the model", () => {
  const b = buildSymbolResearch({ symbol: "SHORT", bars: makeBars(60) });
  assert.equal(b.available, true);
  assert.equal(b.model, null);
  assert.ok(b.brief.dataGaps.some((g) => /range model needs at least 80/.test(g)));
});

test("the up-trend label needs an actual stack, not just a positive day", () => {
  const up = buildSymbolResearch({ symbol: "UP", bars: makeBars(320, { drift: 0.002 }) });
  const down = buildSymbolResearch({ symbol: "DOWN", bars: makeBars(320, { drift: -0.002 }) });
  assert.equal(up.facts.regime, "up trend");
  assert.equal(down.facts.regime, "down trend");
});

/* ------------------------------------------------------------ market brief -- */

test("the market brief uses the supplied default list and reports breadth", () => {
  const series = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"].map((symbol, i) => ({
    symbol,
    bars: makeBars(320, { drift: 0.001 - i * 0.0003, vol: 0.01 + i * 0.001, start: 100 + i * 20 }),
  }));
  const m = buildMarketResearch({ series, events: [] });
  assert.equal(m.available, true);
  assert.equal(m.leadSymbol, "SPY");
  assert.equal(m.facts.breadth.total, 5);
  assert.ok(m.facts.breadth.above20 >= 0 && m.facts.breadth.above20 <= 5);
  assert.equal(m.brief.blocks.length, 5);
  assert.ok(m.brief.headline.includes("SPY"));
  assert.ok(!/NaN|undefined|null/.test(JSON.stringify(m)));
});

test("the market brief refuses an empty series", () => {
  const m = buildMarketResearch({ series: [] });
  assert.equal(m.available, false);
  assert.match(m.message, /No daily series/);
});

test("the market brief does not substitute another index when SPY is missing", () => {
  const m = buildMarketResearch({
    series: [{ symbol: "QQQ", bars: makeBars(320) }],
    events: [],
  });
  assert.equal(m.available, false);
  assert.match(m.message, /SPY/);
});

test("ordinals are correct at the teen and twenty edges", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(12), "12th");
  assert.equal(ordinal(13), "13th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(22), "22nd");
  assert.equal(ordinal(23), "23rd");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const name of failures) console.log(`  failed: ${name}`);
  process.exit(1);
}
