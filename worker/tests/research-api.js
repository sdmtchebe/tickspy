/* Route tests for /api/research/*.
 *
 *   node tests/research-api.js
 *
 * These run the real Worker handler with a stubbed Yahoo response and no KV, so
 * they exercise the route, the bars cache, the research cache and the payload
 * shape together. The pure engine has its own suite; this one is about the seam
 * the desk actually calls.
 */
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { researchKey } from "../src/internals.js";

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${(e && e.message) || e}`);
  }
}

function makeBars(n = 320, drift = 0.001, vol = 0.01, start = 100) {
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
const PAYLOAD = {
  chart: {
    result: [
      {
        meta: {},
        timestamp: BARS.map((b) => Date.parse(b.t) / 1000),
        indicators: {
          quote: [
            {
              open: BARS.map((b) => b.o),
              high: BARS.map((b) => b.h),
              low: BARS.map((b) => b.l),
              close: BARS.map((b) => b.c),
              volume: BARS.map((b) => b.v),
            },
          ],
        },
      },
    ],
    error: null,
  },
};

const ENV = { CACHE: null, ALLOWED_ORIGINS: "*", DESK_SYMBOLS: "SPY,QQQ" };
const realFetch = globalThis.fetch;
let yahooCalls = 0;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("query1.finance.yahoo.com")) {
    yahooCalls += 1;
    if (u.includes("/BAD")) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(PAYLOAD) };
  }
  // The calendar is irrelevant to these tests; failing fast keeps them offline.
  return { ok: false, status: 503, text: async () => "offline" };
};

try {
  await test("the symbol route returns a complete brief and caches it", async () => {
    const first = await worker.fetch(
      new Request("https://api.test/api/research/brief?symbol=SPY"),
      ENV,
      {}
    );
    assert.equal(first.status, 200);
    const a = await first.json();
    assert.equal(a.available, true);
    assert.equal(a.symbol, "SPY");
    assert.equal(a.brief.blocks.length, 5);
    assert.ok(a.model && a.model.band.p10 < a.model.band.p90);
    assert.equal(a.cache.hit, false);
    const afterFirst = yahooCalls;

    const second = await worker.fetch(
      new Request("https://api.test/api/research/brief?symbol=SPY"),
      ENV,
      {}
    );
    const b = await second.json();
    assert.equal(b.cache.hit, true);
    assert.equal(yahooCalls, afterFirst, "a cached brief must not fetch prices again");
  });

  await test("the market route returns breadth over the configured default list", async () => {
    const res = await worker.fetch(new Request("https://api.test/api/research/market"), ENV, {});
    assert.equal(res.status, 200);
    const m = await res.json();
    assert.equal(m.available, true);
    assert.equal(m.leadSymbol, "SPY");
    assert.equal(m.facts.breadth.total, 2);
    assert.equal(m.brief.blocks.length, 5);
  });

  await test("a malformed ticker is refused before any upstream call", async () => {
    const before = yahooCalls;
    const res = await worker.fetch(
      new Request("https://api.test/api/research/brief?symbol=!!!"),
      ENV,
      {}
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "bad_symbol");
    assert.equal(yahooCalls, before);
  });

  await test("an unknown but well-formed ticker maps to 404", async () => {
    const res = await worker.fetch(
      new Request("https://api.test/api/research/brief?symbol=BAD"),
      ENV,
      {}
    );
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "unknown_symbol");
  });

  await test("the market key cannot collide with a literal MARKET ticker key", () => {
    assert.notEqual(researchKey("market"), researchKey("MARKET"));
  });
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const name of failures) console.log(`  failed: ${name}`);
  process.exit(1);
}
