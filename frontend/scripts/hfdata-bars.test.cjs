const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayload, sessionInfo } = require('./hfdata-bars');

const session = (day, openUTC, closeUTC) => Array.from({ length: 390 }, (_, i) => {
  const o = 100 + i / 100, c = o + .05;
  return { t: new Date(Date.parse(`${day}T${openUTC}:00Z`) + i * 60000).toISOString(),
    o, h: o + .4, l: o - .3, c, v: 100 + i };
});

test('New York regular-session aggregation uses DST and complete five-minute buckets', () => {
  const winter = session('2026-03-06', '14:30');
  const summer = session('2026-03-09', '13:30');
  const before = { t: '2026-03-09T13:29:00Z', o: 100, h: 100.1, l: 99.9, c: 100, v: 100000 };
  const after = { t: '2026-03-09T20:00:00Z', o: 100, h: 100.1, l: 99.9, c: 100, v: 100000 };
  const p = buildPayload('SPY', [...summer, after, ...winter, before], Date.parse('2026-03-10T06:00:00Z'));
  assert.equal(sessionInfo(winter[0].t).minute, 570);
  assert.equal(sessionInfo(summer[0].t).minute, 570);
  assert.equal(p.tf, '5Min');
  assert.equal(p.bars.length, 156); assert.equal(p.daily.length, 2);
  assert.equal(p.sessionDate, '2026-03-09');
  assert.equal(p.bars[0].t, winter[0].t); assert.equal(p.bars[78].t, summer[0].t);
  assert.deepEqual(p.bars[78], {
    t: summer[0].t, o: summer[0].o, h: summer[4].h,
    l: summer[0].l, c: summer[4].c, v: summer.slice(0, 5).reduce((n, b) => n + b.v, 0)
  });
  assert.deepEqual(p.daily[1], {
    t: summer[0].t, o: summer[0].o, h: summer.at(-1).h,
    l: summer[0].l, c: summer.at(-1).c, v: summer.reduce((n, b) => n + b.v, 0)
  });
});

test('today’s unfinished session is excluded until the regular close', () => {
  const bars = session('2026-03-09', '13:30');
  assert.equal(buildPayload('SPY', bars, Date.parse('2026-03-09T19:59:00Z')).bars.length, 0);
  assert.equal(buildPayload('SPY', bars, Date.parse('2026-03-09T20:00:00Z')).bars.length, 78);
});

test('missing minutes are aggregated rather than fabricated', () => {
  const bars = session('2026-03-09', '13:30').filter((_, i) => i % 5 !== 2);
  const p = buildPayload('AMD', bars, Date.parse('2026-03-10T06:00:00Z'));
  assert.equal(p.bars.length, 78);
  assert.equal(p.bars[0].v, bars.slice(0, 4).reduce((n, b) => n + b.v, 0));
  assert.equal(p.daily[0].v, bars.reduce((n, b) => n + b.v, 0));
});
