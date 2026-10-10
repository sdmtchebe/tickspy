/* Tests for the TickSPY Worker.
 *
 *   cd worker && npm test        (or: node tests/run.js)
 *
 * No dependencies and no network: the parse, merge and caching logic is plain
 * JavaScript, the upstream calls are stubbed, and the Worker handler is invoked
 * directly. Runs anywhere Node 18+ runs.
 */

import assert from "node:assert/strict";

import { parseFeed, mergeNews, clean, parseDate, decodeEntities } from "../src/rss.js";
import { cached, createMemory, warm, singleFlight, MEMORY_LIMIT } from "../src/cache.js";
import {
  buildPrompt,
  generateOverview,
  DEFAULT_MODEL,
} from "../src/gemini.js";
import {
  parseCsv,
  stooqSymbol,
  knownInterval,
  detectZone,
  dailySeries,
  intradaySession,
  intradaySessions,
  aggregate,
  wallToUtc,
  etParts,
  fetchSeries,
  seriesUrl,
} from "../src/bars.js";
import worker, { upcomingEvents, _memory, BARS_CRON, budgetAllows, _fetchBudget, BARS_KEY_PREFIX } from "../src/index.js";
import {
  yahooSymbol,
  chartUrl,
  parseChart,
  dailyFromRows,
  intradaySessions as yahooSessions,
  fetchYahooSeries,
  YAHOO_BASE,
} from "../src/yahoo.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((e) => {
      failures.push({ name, error: e });
      console.log(`  FAIL ${name}\n         ${(e && e.message) || e}`);
    });
}

/* ------------------------------------------------------------------ fixtures */

/* Price fixtures. Stooq stamps its CSV in its own market clock (CET/CEST), so the
 * realistic fixture is a US session written in Warsaw time: 09:30-15:55 ET is
 * 15:30-21:55 CEST on 2026-10-08 (US on EDT, Europe on CEST). If the code ever
 * stopped re-reading the stamps, the session would land at 15:30 ET and the
 * assertions below about 13:30Z would fail. */
const SESSION_DATE = "2026-10-08";

function csv(rows) {
  return "Date,Open,High,Low,Close,Volume\n" + rows.map((r) => r.join(",")).join("\n") + "\n";
}

/** A 5-minute series covering the regular session, expressed in `startMin` local. */
function intradayCsv(date, { startMin, count, step = 5 } = {}) {
  const rows = [];
  let px = 500;
  for (let i = 0; i < count; i++) {
    const m = startMin + i * step;
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const o = px;
    const c = px + 0.1;
    rows.push([
      `${date} ${hh}:${mm}:00`,
      o.toFixed(2),
      (Math.max(o, c) + 0.2).toFixed(2),
      (Math.min(o, c) - 0.2).toFixed(2),
      c.toFixed(2),
      String(1000 + i),
    ]);
    px = c;
  }
  return csv(rows);
}

const WARSAW_5MIN = intradayCsv(SESSION_DATE, { startMin: 15 * 60 + 30, count: 78 });
const ET_5MIN = intradayCsv(SESSION_DATE, { startMin: 9 * 60 + 30, count: 78 });
const DAILY_CSV = csv([
  ["2026-10-06", "498.10", "501.40", "497.20", "500.35", "61200000"],
  ["2026-10-07", "500.60", "503.10", "499.05", "502.80", "58100000"],
  [SESSION_DATE, "502.90", "506.75", "502.10", "505.60", "57400000"],
]);

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
<item>
  <title><![CDATA[Fed minutes &amp; jobs data in focus]]></title>
  <link>https://example.com/a</link>
  <guid>guid-a</guid>
  <pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate>
  <description><![CDATA[<p>Stocks &amp; bonds <b>steady</b> ahead of the release.</p>]]></description>
</item>
<item>
  <title>Oil slips 2% &lt;b&gt;as&lt;/b&gt; supply rises</title>
  <link>https://example.com/b</link>
  <guid>guid-b</guid>
  <pubDate>2026-10-05T13:30:00Z</pubDate>
  <description>Plain summary</description>
</item>
<item>
  <title>No date here</title>
  <link>https://example.com/c</link>
  <guid>guid-c</guid>
</item>
<item>
  <description>Item with no title should be dropped</description>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom headline</title>
    <link rel="alternate" href="https://example.com/atom-1"/>
    <id>tag:example.com,2026:1</id>
    <updated>2026-10-05T12:00:00Z</updated>
    <summary>An atom summary</summary>
  </entry>
</feed>`;

const CAL = [
  { title: "ISM Services PMI", country: "USD", date: "2030-01-02T15:00:00-05:00", impact: "Medium", forecast: "55.1", previous: "55.4" },
  { title: "FOMC Minutes", country: "USD", date: "2030-01-03T19:00:00-05:00", impact: "High", forecast: "", previous: "" },
  { title: "ECB Rate", country: "EUR", date: "2030-01-02T12:00:00-05:00", impact: "High", forecast: "", previous: "" },
  { title: "Low impact thing", country: "USD", date: "2030-01-04T12:00:00-05:00", impact: "Low", forecast: "", previous: "" },
  { title: "Already happened", country: "USD", date: "2000-01-01T12:00:00-05:00", impact: "High", forecast: "", previous: "" },
];

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(k, type) {
      await sleep(1);
      const v = store.get(k);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) {
      await sleep(1);
      store.set(k, v);
    },
    async delete(k) {
      await sleep(1);
      store.delete(k);
    },
  };
}

/* -------------------------------------------------------------------- tests */
async function main() {
  console.log("rss.js");

  await test("decodes named and numeric entities", () => {
    assert.equal(decodeEntities("a &amp; b &#39;q&#39; &mdash; c"), "a & b 'q' \u2014 c");
    assert.equal(decodeEntities("&unknown;"), "&unknown;");
    assert.equal(decodeEntities("100\u00a0%".replace("\u00a0", "&nbsp;")), "100 %");
  });

  await test("clean strips CDATA and markup but keeps literal entities", () => {
    assert.equal(clean("<![CDATA[<p>Hello &amp; welcome</p>]]>"), "Hello & welcome");
    // An escaped tag must survive as text, not become markup and vanish.
    assert.equal(clean("a &lt;b&gt; c"), "a <b> c");
  });

  await test("parseDate handles RFC-822, ISO with Z, and bare UTC-less stamps", () => {
    assert.equal(parseDate("Mon, 05 Oct 2026 14:00:00 GMT"), Date.UTC(2026, 9, 5, 14, 0, 0));
    assert.equal(parseDate("2026-10-05T13:30:00Z"), Date.UTC(2026, 9, 5, 13, 30, 0));
    // Investing.com sends this shape; it must not be read as local time.
    assert.equal(parseDate("2026-10-05 13:30:00"), Date.UTC(2026, 9, 5, 13, 30, 0));
    assert.equal(parseDate(""), null);
    assert.equal(parseDate("not a date"), null);
  });

  await test("parses RSS items, CDATA, links and dates", () => {
    const items = parseFeed(RSS, "TestSource");
    assert.equal(items.length, 3, "item without a title must be dropped");
    assert.equal(items[0].title, "Fed minutes & jobs data in focus");
    assert.equal(items[0].url, "https://example.com/a");
    assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 5, 14, 0, 0));
    assert.equal(items[0].summary, "Stocks & bonds steady ahead of the release.");
    assert.match(items[0].id, /^TestSource:guid-a$/);
    assert.equal(items[1].title, "Oil slips 2% <b>as</b> supply rises");
    assert.equal(items[2].publishedAt, null, "a missing date is null, not NaN");
  });

  await test("parses Atom entries via the fallback path", () => {
    const items = parseFeed(ATOM, "AtomSrc");
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Atom headline");
    assert.equal(items[0].url, "https://example.com/atom-1");
    assert.equal(items[0].publishedAt, Date.UTC(2026, 9, 5, 12, 0, 0));
  });

  await test("malformed input yields nothing instead of throwing", () => {
    assert.deepEqual(parseFeed("", "X"), []);
    assert.deepEqual(parseFeed("<not-a-feed/>", "X"), []);
    assert.deepEqual(parseFeed(null, "X"), []);
  });

  await test("mergeNews dedupes by id and by identical title", () => {
    const merged = mergeNews([
      { id: "a:1", title: "Same Headline", publishedAt: 200 },
      { id: "b:9", title: "Same   headline", publishedAt: 100 }, // same after normalising
      { id: "a:2", title: "Other", publishedAt: 300 },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].title, "Other", "newest first");
  });

  await test("mergeNews sorts undated items last without dropping them", () => {
    const merged = mergeNews([
      { id: "a", title: "Undated", publishedAt: null },
      { id: "b", title: "Dated", publishedAt: 5 },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].title, "Dated");
    assert.equal(merged[1].title, "Undated");
  });

  console.log("\ncache.js");

  await test("10,000 concurrent requests make exactly ONE upstream call", async () => {
    const mem = createMemory();
    const inflight = new Map();
    let calls = 0;
    const produce = async () => {
      calls++;
      await sleep(30); // slow enough that every caller arrives before it settles
      return { text: "overview" };
    };
    const results = await Promise.all(
      Array.from({ length: 10000 }, () =>
        cached({ mem, inflight, key: "k", ttlSeconds: 60, produce })
      )
    );
    assert.equal(calls, 1, `expected 1 upstream call, got ${calls}`);
    assert.equal(results.length, 10000);
    assert.ok(results.every((r) => r.value.text === "overview"));
  });

  // The desk's price keys include the ticker, so a caller enumerating symbols
  // writes a new entry each time. Nothing used to remove one, so the per-isolate
  // map could be grown until the isolate died and took real visitors with it.
  await test("the per-isolate cache cannot grow without bound", async () => {
    const mem = createMemory();
    const inflight = new Map();
    const produce = async () => "bars";
    for (let i = 0; i < MEMORY_LIMIT + 25; i++) {
      await cached({ mem, inflight, key: `bars:v1:5Min:SYM${i}`, ttlSeconds: 60, produce });
    }
    assert.ok(mem.size <= MEMORY_LIMIT, `memory grew to ${mem.size} entries`);
    assert.equal(mem.has(`bars:v1:5Min:SYM${MEMORY_LIMIT + 24}`), true, "the newest entry is kept");
    assert.equal(mem.has("bars:v1:5Min:SYM0"), false, "the oldest entry is evicted");
    // and eviction must not break the entry that is still being read
    const again = await cached({ mem, inflight, key: `bars:v1:5Min:SYM${MEMORY_LIMIT + 24}`, ttlSeconds: 60, produce });
    assert.equal(again.cached, true, "a remembered key is still served from memory");
    assert.equal(again.value, "bars");
  });

  await test("a warm cache serves without calling upstream at all", async () => {
    const mem = createMemory();
    const inflight = new Map();
    let calls = 0;
    const produce = async () => {
      calls++;
      return 1;
    };
    await cached({ mem, inflight, key: "k", ttlSeconds: 60, produce });
    for (let i = 0; i < 500; i++) {
      await cached({ mem, inflight, key: "k", ttlSeconds: 60, produce });
    }
    assert.equal(calls, 1);
  });

  await test("a fresh KV entry is reused by a cold isolate", async () => {
    const kv = fakeKv();
    const inflight = new Map();
    let calls = 0;
    const produce = async () => {
      calls++;
      return "v";
    };
    await cached({ mem: createMemory(), inflight, kv, key: "k", ttlSeconds: 60, produce });
    // New isolate: empty memory, same KV.
    const r = await cached({ mem: createMemory(), inflight: new Map(), kv, key: "k", ttlSeconds: 60, produce });
    assert.equal(calls, 1, "KV must satisfy the second isolate");
    assert.equal(r.cached, true);
    assert.equal(r.stale, false);
  });

  await test("an expired entry is still served immediately, marked stale", async () => {
    const kv = fakeKv();
    const inflight = new Map();
    let calls = 0;
    const produce = async () => {
      calls++;
      return `v${calls}`;
    };
    // Write an entry that is 2 hours old by using a controlled clock.
    let clock = 1_000_000;
    await cached({ mem: createMemory(), inflight, kv, key: "k", ttlSeconds: 60, produce, now: () => clock });
    clock += 2 * 60 * 60 * 1000; // past TTL and grace
    const r = await cached({
      mem: createMemory(),
      inflight,
      kv,
      key: "k",
      ttlSeconds: 60,
      graceSeconds: 300,
      produce,
      now: () => clock,
    });
    assert.equal(r.value, "v2", "past grace, so it rebuilds");
    assert.equal(calls, 2);
  });

  await test("stale-while-revalidate serves old data without waiting for the refresh", async () => {
    const kv = fakeKv();
    let calls = 0;
    let clock = 1_000_000;
    // A deliberately slow producer: if the request path awaited it, the elapsed
    // time would show it.
    const produce = async () => {
      calls++;
      await sleep(400);
      return `v${calls}`;
    };
    const first = await cached({
      mem: createMemory(),
      inflight: new Map(),
      kv,
      key: "k",
      ttlSeconds: 60,
      produce,
      now: () => clock,
    });
    assert.equal(first.value, "v1");

    clock += 120_000; // 2 minutes: past TTL, inside grace
    const pending = [];
    const t0 = Date.now();
    const r = await cached({
      mem: createMemory(),
      inflight: new Map(),
      kv,
      key: "k",
      ttlSeconds: 60,
      graceSeconds: 3600,
      produce,
      now: () => clock,
      ctx: { waitUntil: (p) => pending.push(p) },
    });
    const elapsed = Date.now() - t0;

    assert.equal(r.value, "v1", "the visitor gets the old value");
    assert.equal(r.stale, true);
    assert.ok(elapsed < 200, `the request path must not wait for the refresh (took ${elapsed}ms)`);
    assert.equal(pending.length, 1, "the refresh was handed to waitUntil");

    await Promise.all(pending);
    assert.equal(calls, 2, "and it did refresh in the background");
  });

  await test("warm() always rebuilds, so the cron is never a no-op", async () => {
    const kv = fakeKv();
    const mem = createMemory();
    const inflight = new Map();
    let calls = 0;
    const produce = async () => {
      calls++;
      return calls;
    };
    await warm({ kv, mem, inflight, key: "k", produce });
    await warm({ kv, mem, inflight, key: "k", produce });
    assert.equal(calls, 2, "unlike cached(), warm must not short-circuit");
  });

  await test("a producer error propagates instead of being cached as a value", async () => {
    const inflight = new Map();
    let calls = 0;
    await assert.rejects(
      cached({
        mem: createMemory(),
        inflight,
        key: "k",
        ttlSeconds: 60,
        produce: async () => {
          calls++;
          throw new Error("boom");
        },
      }),
      /boom/
    );
    assert.equal(calls, 1);
    // The failed single-flight entry must be cleared, so a retry can succeed.
    const ok = await cached({ mem: createMemory(), inflight, key: "k", ttlSeconds: 60, produce: async () => "recovered" });
    assert.equal(ok.value, "recovered");
  });

  await test("singleFlight collapses concurrent callers onto one promise", async () => {
    const inflight = new Map();
    let calls = 0;
    const slow = async () => {
      calls++;
      await sleep(20);
      return 42;
    };
    const all = await Promise.all(Array.from({ length: 50 }, () => singleFlight(inflight, "x", slow)));
    assert.equal(calls, 1);
    assert.ok(all.every((v) => v === 42));
  });

  console.log("\ngemini.js");

  await test("the prompt is built from server data only", () => {
    const p = buildPrompt({
      news: [{ source: "CNBC", title: "Headline one" }],
      events: [{ when: "2030-01-02", title: "ISM Services PMI", impact: "Medium", forecast: "55.1" }],
    });
    assert.match(p, /Headline one/);
    assert.match(p, /CNBC/);
    assert.match(p, /ISM Services PMI/);
    assert.match(p, /Summarise the above in 3 to 4 bullets/);
  });

  await test("the prompt is bounded regardless of input size", () => {
    const news = Array.from({ length: 500 }, (_, i) => ({ source: "S", title: `Headline ${i}` }));
    const events = Array.from({ length: 200 }, (_, i) => ({ when: "x", title: `Event ${i}`, impact: "High" }));
    const p = buildPrompt({ news, events });
    assert.ok(p.length < 4000, `prompt grew to ${p.length} chars`);
    assert.ok(!p.includes("Headline 400"), "should have truncated the headline list");
  });

  await test("generateOverview parses a real-shaped response", async () => {
    const fetchImpl = async (url, init) => {
      assert.match(url, /gemini-flash-lite-latest:generateContent$/);
      assert.equal(init.headers["x-goog-api-key"], "SECRET");
      const body = JSON.parse(init.body);
      assert.ok(body.systemInstruction.parts[0].text.includes("factual"));
      assert.ok(body.generationConfig.maxOutputTokens <= 500);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Bullet one\nBullet two" }] }, finishReason: "STOP" }],
          usageMetadata: { totalTokenCount: 42 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const out = await generateOverview({ apiKey: "SECRET", news: [], events: [], fetchImpl });
    assert.equal(out.text, "Bullet one\nBullet two");
    assert.equal(out.model, DEFAULT_MODEL);
    assert.equal(out.usage.totalTokenCount, 42);
  });

  await test("generateOverview refuses without a key", async () => {
    await assert.rejects(generateOverview({ apiKey: "", fetchImpl: async () => new Response("{}") }), /GEMINI_API_KEY/);
  });

  await test("generateOverview does not leak the upstream error body", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded for key ABC123" } }), { status: 429 });
    await assert.rejects(generateOverview({ apiKey: "k", fetchImpl }), (e) => {
      assert.match(e.message, /Gemini responded 429/);
      assert.ok(!e.message.includes("ABC123"), "must not echo the body");
      return true;
    });
  });

  await test("generateOverview rejects an empty candidate", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    await assert.rejects(generateOverview({ apiKey: "k", fetchImpl }), /no text/);
  });

  console.log("\nindex.js");

  await test("upcomingEvents keeps future USD medium/high only", () => {
    const ev = upcomingEvents(CAL, { from: Date.parse("2030-01-01T00:00:00Z") });
    assert.deepEqual(
      ev.map((e) => e.title),
      ["ISM Services PMI", "FOMC Minutes"]
    );
  });

  await test("OPTIONS returns 204 with CORS headers for an allowed origin", async () => {
    const req = new Request("https://api.test/api/overview", {
      method: "OPTIONS",
      headers: { Origin: "https://sdmtchebe.github.io" },
    });
    const res = await worker.fetch(req, { ALLOWED_ORIGINS: "https://sdmtchebe.github.io" }, {});
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://sdmtchebe.github.io");
    assert.equal(res.headers.get("Vary"), "Origin");
  });

  await test("an unlisted origin gets no CORS grant", async () => {
    const req = new Request("https://api.test/api/health", { headers: { Origin: "https://evil.example" } });
    const res = await worker.fetch(req, { ALLOWED_ORIGINS: "https://sdmtchebe.github.io" }, {});
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  await test("/api/health reports configuration without echoing secrets", async () => {
    const req = new Request("https://api.test/api/health");
    const res = await worker.fetch(req, { GEMINI_API_KEY: "SUPER-SECRET-VALUE", CACHE: null }, {});
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!text.includes("SUPER-SECRET-VALUE"), "the key must never appear in a response");
    const body = JSON.parse(text);
    assert.equal(body.configured.geminiKey, true);
    assert.equal(body.ok, true);
  });

  await test("/api/overview returns 503 when no key is configured, without calling Gemini", async () => {
    const req = new Request("https://api.test/api/overview");
    const res = await worker.fetch(req, { GEMINI_API_KEY: "" }, {});
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "not_configured");
    assert.match(body.message, /GEMINI_API_KEY/);
  });

  await test("/api/overview serves from cache and never re-calls Gemini", async () => {
    // Count Gemini calls with a stubbed global fetch: news + calendar + gemini.
    const realFetch = globalThis.fetch;
    let geminiCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("generativelanguage.googleapis.com")) {
        geminiCalls++;
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "- A bullet" }] }, finishReason: "STOP" }] }),
          { status: 200 }
        );
      }
      if (u.includes("faireconomy")) {
        return new Response(JSON.stringify(CAL), { status: 200 });
      }
      return new Response(RSS, { status: 200 });
    };
    try {
      const env = { GEMINI_API_KEY: "k", GEMINI_MODEL: DEFAULT_MODEL, CACHE: null, ALLOWED_ORIGINS: "*" };
      const ctx = { waitUntil: () => {} };
      const first = await worker.fetch(new Request("https://api.test/api/overview"), env, ctx);
      assert.equal(first.status, 200);
      const b1 = await first.json();
      assert.equal(b1.text, "- A bullet");
      assert.ok(b1.events.length >= 1, "the overview should carry upcoming events");
      assert.equal(geminiCalls, 1);

      for (let i = 0; i < 200; i++) {
        const res = await worker.fetch(new Request("https://api.test/api/overview"), env, ctx);
        assert.equal(res.status, 200);
      }
      assert.equal(geminiCalls, 1, `200 further visits must reuse the cache, got ${geminiCalls} calls`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("/api/news and /api/calendar return normalised JSON", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) =>
      String(url).includes("faireconomy")
        ? new Response(JSON.stringify(CAL), { status: 200 })
        : new Response(RSS, { status: 200 });
    try {
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      _memory.clear(); // per-isolate cache persists across cases in one process
      const news = await (await worker.fetch(new Request("https://api.test/api/news"), env, {})).json();
      assert.ok(news.news.length > 0);
      assert.ok(news.sources.length >= 6, "all sources are reported");
      assert.ok(news.news.every((n) => n.title && n.source));

      const cal = await (await worker.fetch(new Request("https://api.test/api/calendar"), env, {})).json();
      assert.equal(cal.events.length, CAL.length);
      assert.ok(cal.events.every((e) => typeof e.title === "string"));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("a news source failing degrades coverage instead of breaking the endpoint", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("marketwatch") || u.includes("dowjones")) return new Response("nope", { status: 503 });
      return new Response(RSS, { status: 200 });
    };
    try {
      _memory.clear(); // otherwise the previous case's cached news is reused
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const res = await worker.fetch(new Request("https://api.test/api/news"), env, {});
      const body = await res.json();
      assert.equal(res.status, 200, "one dead feed must not fail the request");
      assert.ok(body.news.length > 0);
      assert.equal(body.sourcesTotal - body.sourcesOk, 1, "the failure is reported");
      assert.ok(body.sources.some((s) => !s.ok && s.status === 503));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("unknown routes 404 and non-GET 405", async () => {
    const env = { ALLOWED_ORIGINS: "*" };
    const notFound = await worker.fetch(new Request("https://api.test/nope"), env, {});
    assert.equal(notFound.status, 404);
    const method = await worker.fetch(new Request("https://api.test/api/news", { method: "POST" }), env, {});
    assert.equal(method.status, 405);
  });

console.log("\nbars.js");

  await test("stooqSymbol maps US tickers and refuses anything else", () => {
    assert.equal(stooqSymbol("SPY"), "spy.us");
    assert.equal(stooqSymbol(" aapl "), "aapl.us");
    assert.equal(stooqSymbol("BRK.B"), "brk-b.us");
    assert.equal(stooqSymbol("SPY.US"), "spy.us");
    // Nothing that could escape into the upstream URL.
    assert.equal(stooqSymbol("../../etc/passwd"), null);
    assert.equal(stooqSymbol("SPY&i=d"), null);
    assert.equal(stooqSymbol(""), null);
    assert.equal(stooqSymbol("WAY-TOO-LONG-A-TICKER"), null);
  });

  await test("knownInterval accepts only the free timeframes", () => {
    assert.ok(["1Day", "5Min", "15Min"].every(knownInterval));
    // Hourly is refused on purpose: a session holds too few hourly bars to pass
    // the session check, so it would be a broken view rather than a thin one.
    assert.ok(!knownInterval("1Hour") && !knownInterval("1Min") && !knownInterval("9Day") && !knownInterval(""));
  });

  await test("seriesUrl carries the symbol, interval and a bounded date range", () => {
    const u = new URL(seriesUrl("spy.us", "5", { days: 10, now: Date.UTC(2026, 9, 8) }));
    assert.equal(u.hostname, "stooq.com");
    assert.equal(u.pathname, "/q/d/l/");
    assert.equal(u.searchParams.get("s"), "spy.us");
    assert.equal(u.searchParams.get("i"), "5");
    assert.equal(u.searchParams.get("d2"), "20261008");
    assert.equal(u.searchParams.get("d1"), "20260928");
  });

  await test("parseCsv reads daily rows, strips the header and skips junk lines", () => {
    const rows = parseCsv(DAILY_CSV + "not,a,row\n\n");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].raw_date, "2026-10-06");
    assert.equal(rows[0].c, 500.35);
    assert.equal(rows[2].v, 57400000);
    assert.equal(rows[0].minutes, 0, "a daily row has no time component");
    assert.equal(rows[2].raw_date, SESSION_DATE);
  });

  await test("parseCsv reads intraday rows with their time of day", () => {
    const rows = parseCsv(WARSAW_5MIN);
    assert.equal(rows.length, 78);
    assert.equal(rows[0].minutes, 15 * 60 + 30);
    assert.equal(rows[77].minutes, 21 * 60 + 55);
  });

  await test("parseCsv refuses each way the upstream says no", () => {
    assert.throws(() => parseCsv(""), /empty response/);
    assert.throws(() => parseCsv("<!doctype html><html>captcha</html>"), /HTML page/);
    assert.throws(() => parseCsv("Exceeded the daily hits limit"), /quota/);
    assert.throws(() => parseCsv("Date,Open,High,Low,Close,Volume\n"), /header with no rows/);
    assert.throws(() => parseCsv("a,b,c,d,e\n"), /none of them were parseable/);
  });

  await test("wallToUtc and etParts agree on the same instant in different clocks", () => {
    // 09:30 in New York and 15:30 in Warsaw are the same moment on this date.
    const fromEt = wallToUtc("America/New_York", 2026, 10, 8, 9 * 60 + 30);
    const fromWarsaw = wallToUtc("Europe/Warsaw", 2026, 10, 8, 15 * 60 + 30);
    assert.equal(new Date(fromEt).toISOString(), "2026-10-08T13:30:00.000Z");
    assert.equal(fromEt, fromWarsaw);
    assert.deepEqual(etParts(fromEt), { date: SESSION_DATE, minutes: 9 * 60 + 30 });
  });

  await test("detectZone finds the clock the CSV is written in", () => {
    const warsaw = detectZone(parseCsv(WARSAW_5MIN));
    assert.equal(warsaw.zone, "Europe/Warsaw");
    assert.equal(warsaw.coverage, 1);

    // The same session already stamped in ET must not be shifted.
    const et = detectZone(parseCsv(ET_5MIN));
    assert.equal(et.zone, "America/New_York");
    assert.equal(et.coverage, 1);
  });

  await test("intradaySession returns the previous session as ET instants", () => {
    const s = intradaySession(parseCsv(WARSAW_5MIN), "Europe/Warsaw");
    assert.equal(s.date, SESSION_DATE);
    assert.equal(s.bars.length, 78);
    assert.equal(s.bars[0].t, "2026-10-08T13:30:00.000Z", "the first bar is 09:30 ET");
    assert.equal(s.bars[77].t, "2026-10-08T19:55:00.000Z", "the last is 15:55 ET");
    assert.deepEqual(
      s.bars.map((b) => etParts(Date.parse(b.t)).minutes).filter((m) => m < 9 * 60 + 30 || m >= 16 * 60),
      [],
      "no bar may fall outside the regular session"
    );
  });

  await test("intradaySession ignores extended hours and a partial current day", () => {
    // Pre-market and post-market prints around the same session.
    const extended = csv([
      ["2026-10-08 09:00:00", "1", "1", "1", "1", "1"],
      ...WARSAW_5MIN.trim().split("\n").slice(1).map((l) => l.split(",")),
      ["2026-10-08 23:30:00", "1", "1", "1", "1", "1"],
    ]);

    const s = intradaySession(parseCsv(extended), "Europe/Warsaw");
    assert.equal(s.bars.length, 78, "only the regular session survives");

    // A barely-started session must not be mistaken for the completed one.
    const lines = (text) => text.trim().split("\n").slice(1).map((l) => l.split(","));
    const partial = csv([
      ...lines(WARSAW_5MIN),
      ...lines(intradayCsv("2026-10-09", { startMin: 15 * 60 + 30, count: 4 })),
    ]);
    const p = intradaySession(parseCsv(partial), "Europe/Warsaw");
    assert.equal(p.date, SESSION_DATE, "the last COMPLETE session wins");
    assert.equal(p.bars.length, 78);
  });

  await test("intradaySessions keeps the last three sessions, in order, rolled up on request", () => {
    const lines = (text) => text.trim().split("\n").slice(1).map((l) => l.split(","));
    const three = csv([
      ...lines(intradayCsv("2026-10-06", { startMin: 15 * 60 + 30, count: 78 })),
      ...lines(intradayCsv("2026-10-07", { startMin: 15 * 60 + 30, count: 78 })),
      ...lines(WARSAW_5MIN),
    ]);
    const s = intradaySessions(parseCsv(three), "Europe/Warsaw", 3);
    assert.equal(s.dates.length, 3);
    assert.equal(s.date, SESSION_DATE, "the newest session is the one replayed");
    assert.equal(s.bars.length, 234);
    assert.deepEqual(s.dates, ["2026-10-06", "2026-10-07", SESSION_DATE]);
    // Ascending, and each session starts at its own 13:30Z open.
    assert.equal(s.bars[0].t, "2026-10-06T13:30:00.000Z");
    assert.equal(s.bars[78].t, "2026-10-07T13:30:00.000Z");
    assert.equal(s.bars[156].t, "2026-10-08T13:30:00.000Z");

    const one = intradaySessions(parseCsv(three), "Europe/Warsaw", 1);
    assert.equal(one.bars.length, 78);
    assert.equal(one.date, SESSION_DATE);
  });

  await test("aggregate rolls 5-minute bars into 15-minute ones", () => {
    const bars = intradaySession(parseCsv(WARSAW_5MIN), "Europe/Warsaw").bars;
    const q = aggregate(bars, 15);
    assert.equal(q.length, 26);
    assert.equal(q[0].t, bars[0].t);
    assert.equal(q[0].o, bars[0].o);
    assert.equal(q[0].c, bars[2].c);
    assert.equal(q[0].v, bars[0].v + bars[1].v + bars[2].v);
    assert.equal(q[0].h, Math.max(bars[0].h, bars[1].h, bars[2].h));
  });

  await test("dailySeries stamps each day at its 09:30 ET open, ascending", () => {
    const bars = dailySeries(parseCsv(DAILY_CSV));
    assert.equal(bars.length, 3);
    assert.deepEqual(bars.map((b) => b.t), [
      "2026-10-06T13:30:00.000Z",
      "2026-10-07T13:30:00.000Z",
      "2026-10-08T13:30:00.000Z",
    ]);
    assert.equal(bars[2].c, 505.6);
  });

  await test("fetchSeries returns a daily series and a replayed session from stubs", async () => {
    const stub = async (url) => {
      const i = new URL(String(url)).searchParams.get("i");
      return new Response(i === "d" ? DAILY_CSV : WARSAW_5MIN, { status: 200 });
    };

    const day = await fetchSeries({ symbol: "spy", tf: "1Day", fetcher: stub });
    assert.equal(day.symbol, "SPY");
    assert.equal(day.bars.length, 3);
    assert.equal(day.sessionDate, SESSION_DATE);
    assert.equal(day.asOf, SESSION_DATE);
    assert.equal(day.delayed, true);
    assert.equal(day.source, "stooq");

    const five = await fetchSeries({ symbol: "SPY", tf: "5Min", fetcher: stub });
    assert.equal(five.bars.length, 78);
    assert.equal(five.tz, "Europe/Warsaw", "the source clock was worked out, not assumed");
    assert.equal(five.sessionDate, SESSION_DATE);
    assert.equal(five.daily.length, 3, "intraday also carries the daily series the desk reads");
    assert.equal(five.bars[0].t, "2026-10-08T13:30:00.000Z");

    assert.equal(five.sessions, 1, "only one complete session exists in this fixture");

    const fifteen = await fetchSeries({ symbol: "SPY", tf: "15Min", fetcher: stub });
    assert.equal(fifteen.bars.length, 26);

    await assert.rejects(fetchSeries({ symbol: "SPY", tf: "1Min", fetcher: stub }), /Unsupported timeframe/);
    await assert.rejects(fetchSeries({ symbol: "not a ticker!", tf: "1Day", fetcher: stub }), /recognisable ticker/);
  });

  /* ------------------------------------------------------------- yahoo -- */
  console.log("\nyahoo");

  /* A Yahoo chart payload for a set of ET sessions. Timestamps are real epoch
   * seconds at each session's 13:30Z open (EDT), which is the shape the probe
   * measured from a live Worker. */
  function yahooPayload({ interval, sessions, endUtc }) {
    const ts = [], open = [], high = [], low = [], close = [], volume = [];
    const step = (interval === "1d" ? 0 : interval === "5m" ? 300 : 900) * 1000;
    let px = 500;
    for (const [date, count] of sessions) {
      const start = Date.parse(`${date}T13:30:00.000Z`);
      for (let i = 0; i < count; i++) {
        px += 0.05;
        ts.push(Math.round((start + i * step) / 1000));
        open.push(px - 0.2);
        high.push(px + 0.3);
        low.push(px - 0.3);
        close.push(px);
        volume.push(1000 + i);
      }
    }
    return {
      chart: {
        result: [
          {
            meta: {
              symbol: "SPY",
              exchangeTimezoneName: "America/New_York",
              currentTradingPeriod: { regular: { end: endUtc } },
            },
            timestamp: ts,
            indicators: { quote: [{ open, high, low, close, volume }] },
          },
        ],
        error: null,
      },
    };
  }

  const THREE_DAYS = [["2026-10-06", 1], ["2026-10-07", 1], ["2026-10-08", 1]];
  const AFTER_CLOSE = Date.parse("2026-10-09T20:00:00Z") / 1000;

  await test("yahooSymbol normalises the ticker and refuses anything URL-breaking", () => {
    assert.equal(yahooSymbol("spy"), "SPY");
    assert.equal(yahooSymbol(" brk.b "), "BRK-B", "class shares go to dashes");
    assert.equal(yahooSymbol("not a ticker!"), null);
    assert.equal(yahooSymbol("../../etc/passwd"), null);
  });

  await test("chartUrl encodes the symbol rather than pasting it into the path", () => {
    const u = chartUrl("BRK-B", "5m", "5d");
    assert.ok(u.startsWith(YAHOO_BASE));
    assert.equal(u, `${YAHOO_BASE}BRK-B?interval=5m&range=5d`);
  });

  await test("parseChart reads OHLCV, drops nulls, and reports 'no data' as a symbol error", () => {
    const { meta, rows } = parseChart(yahooPayload({ interval: "1d", sessions: THREE_DAYS, endUtc: AFTER_CLOSE }));
    assert.equal(rows.length, 3);
    assert.equal(meta.exchangeTimezoneName, "America/New_York");
    assert.ok(rows[0].ms < rows[2].ms, "ascending in time");
    assert.equal(Math.round(rows[0].o), 500);

    // A range closes with a zero-volume single-price stub; it is not a bar.
    const withStub = yahooPayload({ interval: "1d", sessions: THREE_DAYS, endUtc: AFTER_CLOSE });
    const q = withStub.chart.result[0].indicators.quote[0];
    q.close.push(999); q.open.push(999); q.high.push(999); q.low.push(999); q.volume.push(0);
    withStub.chart.result[0].timestamp.push(AFTER_CLOSE);
    assert.equal(parseChart(withStub).rows.length, 3, "the stub is not counted as a bar");

    assert.throws(() => parseChart({ chart: { error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }), /No data for that symbol/);
    assert.throws(() => parseChart("<html>nope"), /not JSON/);
    assert.throws(() => parseChart({ chart: { result: [], error: null } }), /no result/);
  });

  await test("dailyFromRows stamps each session at its 09:30 ET open, like the CSV path", () => {
    const { rows } = parseChart(yahooPayload({ interval: "1d", sessions: THREE_DAYS, endUtc: AFTER_CLOSE }));
    const bars = dailyFromRows(rows);
    assert.deepEqual(bars.map((b) => b.t), [
      "2026-10-06T13:30:00.000Z",
      "2026-10-07T13:30:00.000Z",
      "2026-10-08T13:30:00.000Z",
    ]);
  });

  await test("intraday sessions drop a partial current session, and keep it once the bell has rung", () => {
    // Three sessions, the last of them partial because the session is still open.
    const partial = yahooPayload({ interval: "5m", sessions: [["2026-10-07", 78], ["2026-10-08", 78], ["2026-10-09", 30]], endUtc: AFTER_CLOSE });
    const { rows, meta } = parseChart(partial);

    const midSession = yahooSessions(rows, meta, Date.parse("2026-10-09T16:00:00Z"));
    assert.equal(midSession.date, "2026-10-08", "today's unfinished session is not replayed");
    assert.deepEqual(midSession.dates, ["2026-10-07", "2026-10-08"]);
    // Every chosen session is handed over, concatenated and in time order - not
    // just the newest. The desk reads prior-day levels and the 21-EMA alignment
    // off these bars, and both need more than one session to say anything.
    assert.equal(midSession.bars.length, 156, "both complete sessions travel together");
    assert.equal(midSession.bars[0].t, "2026-10-07T13:30:00.000Z");
    assert.equal(midSession.bars[78].t, "2026-10-08T13:30:00.000Z");

    const afterClose = yahooSessions(rows, meta, Date.parse("2026-10-09T21:00:00Z"));
    assert.equal(afterClose.date, "2026-10-09", "once it is complete, the newest session wins");
    assert.equal(afterClose.bars.length, 186, "all three sessions, in order");
    assert.equal(afterClose.bars[185].t, "2026-10-09T15:55:00.000Z");

    // A half day closes early, and Yahoo says so - so 13:01 counts as complete.
    const half = yahooPayload({ interval: "5m", sessions: [["2026-10-08", 78], ["2026-11-27", 42]], endUtc: Date.parse("2026-11-27T18:00:00Z") / 1000 });
    const h = parseChart(half);
    assert.equal(yahooSessions(h.rows, h.meta, Date.parse("2026-11-27T18:01:00Z")).date, "2026-11-27");
  });

  await test("fetchYahooSeries returns the desk's payload shape", async () => {
    const stub = async (url) => {
      const q = new URL(String(url)).searchParams;
      const sessions = q.get("interval") === "1d" ? THREE_DAYS : [["2026-10-08", 78]];
      return new Response(JSON.stringify(yahooPayload({ interval: q.get("interval"), sessions, endUtc: AFTER_CLOSE })), { status: 200 });
    };
    const now = () => Date.parse("2026-10-09T21:00:00Z");

    const day = await fetchYahooSeries({ symbol: "spy", tf: "1Day", fetcher: stub, now });
    assert.equal(day.symbol, "SPY");
    assert.equal(day.source, "yahoo");
    assert.equal(day.bars.length, 3);
    assert.equal(day.sessionDate, "2026-10-08");
    assert.equal(day.tz, null);

    const five = await fetchYahooSeries({ symbol: "SPY", tf: "5Min", fetcher: stub, now });
    assert.equal(five.bars.length, 78);
    assert.equal(five.sessionDate, "2026-10-08");
    assert.equal(five.tz, "America/New_York", "the zone comes from the payload, not a guess");
    assert.equal(five.tzCoverage, 1);
    assert.equal(five.daily.length, 3, "intraday carries the daily series the desk reads");
    assert.equal(five.source, "yahoo");

    await assert.rejects(fetchYahooSeries({ symbol: "SPY", tf: "1Min", fetcher: stub, now }), /Unsupported timeframe/);
  });

  await test("fetchSeries prefers Yahoo, falls back to Stooq, and reports both when neither answers", async () => {
    const both = async (url) => {
      const u = String(url);
      if (u.includes("finance.yahoo.com")) {
        const q = new URL(u).searchParams;
        const sessions = q.get("interval") === "1d" ? THREE_DAYS : [["2026-10-08", 78]];
        return new Response(JSON.stringify(yahooPayload({ interval: q.get("interval"), sessions, endUtc: AFTER_CLOSE })), { status: 200 });
      }
      return new Response(new URL(u).searchParams.get("i") === "d" ? DAILY_CSV : WARSAW_5MIN, { status: 200 });
    };
    const now = () => Date.parse("2026-10-09T21:00:00Z");

    const viaYahoo = await fetchSeries({ symbol: "SPY", tf: "1Day", fetcher: both, now });
    assert.equal(viaYahoo.source, "yahoo", "the reachable source is tried first");

    // Yahoo down: the CSV path must still serve the desk.
    const onlyCsv = async (url) => {
      const u = String(url);
      if (u.includes("finance.yahoo.com")) return new Response("<html>challenge</html>", { status: 200 });
      return new Response(new URL(u).searchParams.get("i") === "d" ? DAILY_CSV : WARSAW_5MIN, { status: 200 });
    };
    const viaStooq = await fetchSeries({ symbol: "SPY", tf: "1Day", fetcher: onlyCsv, now });
    assert.equal(viaStooq.source, "stooq");
    assert.equal(viaStooq.bars.length, 3);

    // Neither: one message naming both reasons, not a bare stack trace.
    const down = async () => new Response("nope", { status: 500 });
    await assert.rejects(fetchSeries({ symbol: "SPY", tf: "1Day", fetcher: down, now }), (e) => /Yahoo responded 500/.test(e.message) && /Stooq fallback also failed/.test(e.message));

    // And a pinned source skips the other entirely.
    const pinned = await fetchSeries({ symbol: "SPY", tf: "1Day", fetcher: both, now, source: "stooq" });
    assert.equal(pinned.source, "stooq");
  });

  console.log("\n/api/bars");

  function stubUpstream({ daily = DAILY_CSV, intraday = WARSAW_5MIN, status = 200 } = {}) {
    return async (url) => {
      const u = new URL(String(url));
      if (u.searchParams.get("s") === "bad.us") return new Response("No data", { status: 404 });
      if (status !== 200) return new Response("Exceeded the daily hits limit", { status });
      return new Response(u.searchParams.get("i") === "d" ? daily : intraday, { status: 200 });
    };
  }

  async function withUpstream(impl, fn) {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await fn();
    } finally {
      globalThis.fetch = real;
    }
  }

  await test("GET /api/bars serves the previous session with no API key at all", async () => {
    await withUpstream(stubUpstream(), async () => {
      _memory.clear();
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const res = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=5Min"), env, {});
      assert.equal(res.status, 200);
      const b = await res.json();
      assert.equal(b.symbol, "SPY");
      assert.equal(b.tf, "5Min");
      assert.equal(b.source, "stooq");
      assert.equal(b.delayed, true);
      assert.equal(b.sessionDate, SESSION_DATE);
      assert.equal(b.bars.length, 78);
      assert.equal(b.daily.length, 3);
      assert.ok(b.note, "the payload says what the reader is looking at");
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    });
  });

  await test("GET /api/bars defaults to SPY daily and rejects an unknown timeframe", async () => {
    await withUpstream(stubUpstream(), async () => {
      _memory.clear();
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const b = await (await worker.fetch(new Request("https://api.test/api/bars"), env, {})).json();
      assert.equal(b.symbol, "SPY");
      assert.equal(b.tf, "1Day");
      assert.equal(b.bars.length, 3);

      const bad = await worker.fetch(new Request("https://api.test/api/bars?tf=1Sec"), env, {});
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error, "bad_tf");
    });
  });

  await test("GET /api/bars?symbols= returns one entry per symbol and reports failures", async () => {
    await withUpstream(stubUpstream(), async () => {
      _memory.clear();
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const res = await worker.fetch(
        new Request("https://api.test/api/bars?symbols=SPY,AAPL,BAD&tf=1Day"),
        env,
        {}
      );
      assert.equal(res.status, 200);
      const b = await res.json();
      assert.equal(Object.keys(b.bars).length, 2);
      assert.equal(b.bars.SPY.length, 3);
      assert.equal(b.bars.AAPL.length, 3);
      assert.ok(b.errors.BAD, "one dead symbol must not fail the others");
    });
  });

  await test("GET /api/bars maps an unknown symbol to 404 and a quota to 502", async () => {
    await withUpstream(stubUpstream(), async () => {
      _memory.clear();
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const missing = await worker.fetch(new Request("https://api.test/api/bars?symbol=BAD"), env, {});
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error, "unknown_symbol");
    });
    await withUpstream(stubUpstream({ status: 200, daily: "Exceeded the daily hits limit" }), async () => {
      _memory.clear();
      const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
      const res = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY"), env, {});
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error, "unavailable");
    });
  });

  await test("the /api/bars fetch budget admits calls up to its cap, refuses past it, and re-opens as hits age out", async () => {
    try {
      _fetchBudget.hits.length = 0;
      const t0 = 5_000_000;
      for (let i = 0; i < _fetchBudget.max; i++) {
        assert.equal(budgetAllows(t0), true, "the window admits calls up to the cap");
      }
      assert.equal(budgetAllows(t0), false, "the cap is a hard stop inside one window");
      assert.equal(budgetAllows(t0 + 59_000), false, "still inside the same window");
      assert.equal(budgetAllows(t0 + 60_001), true, "an expired hit frees a slot");

      // Now drive the real endpoint with a full window: once the budget is spent
      // a fresh symbol must be answered without an upstream call at all.
      _fetchBudget.hits.length = 0;
      const now = Date.now();
      for (let i = 0; i < _fetchBudget.max; i++) budgetAllows(now);
      let calls = 0;
      await withUpstream(
        async () => {
          calls++;
          return new Response(DAILY_CSV, { status: 200 });
        },
        async () => {
          _memory.clear();
          const env = { CACHE: null, ALLOWED_ORIGINS: "*" };
          const res = await worker.fetch(new Request("https://api.test/api/bars?symbol=ZZZT"), env, {});
          assert.equal(res.status, 502, "a spent budget is reported, not hidden");
          assert.match((await res.json()).message, /Too many price requests/);
          assert.equal(calls, 0, "upstream is never called once the budget is spent");
        }
      );
    } finally {
      _fetchBudget.hits.length = 0;
    }
  });

  await test("a second visitor reads the cached session instead of re-fetching", async () => {
    let calls = 0;
    const impl = async (url) => {
      calls++;
      return new Response(new URL(String(url)).searchParams.get("i") === "d" ? DAILY_CSV : WARSAW_5MIN, { status: 200 });
    };
    await withUpstream(impl, async () => {
      _memory.clear();
      const kv = fakeKv();
      const env = { CACHE: kv, ALLOWED_ORIGINS: "*" };
      const first = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=5Min"), env, {});
      assert.equal((await first.json()).cache.hit, false);
      const fetched = calls;
      for (let i = 0; i < 25; i++) {
        await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=5Min"), env, {});
      }
      assert.equal(calls, fetched, "further visitors must not touch the upstream");
      // And a cold isolate with only KV still answers without an upstream call.
      _memory.clear();
      const cold = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=5Min"), env, {});
      assert.equal((await cold.json()).cache.hit, true);
      assert.equal(calls, fetched);
    });
  });

  await test("an arbitrary ticker is served without filling the durable cache", async () => {
    await withUpstream(stubUpstream(), async () => {
      _memory.clear();
      const kv = fakeKv();
      const env = { CACHE: kv, ALLOWED_ORIGINS: "*", DESK_SYMBOLS: "SPY" };
      await worker.fetch(new Request("https://api.test/api/bars?symbol=TSLA&tf=1Day"), env, {});
      const keys = [...kv.store.keys()].filter((k) => k.startsWith("bars:"));
      assert.deepEqual(keys, [], "only DESK_SYMBOLS may write to KV");
      const res = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=1Day"), env, {});
      assert.equal(res.status, 200);
      assert.ok([...kv.store.keys()].some((k) => k === `${BARS_KEY_PREFIX}:1Day:SPY`));
    });
  });

  await test("the watchlist range and the detail range never share a cache entry", async () => {
    const impl = async () =>
      new Response(JSON.stringify(yahooPayload({ interval: "1d", sessions: THREE_DAYS, endUtc: AFTER_CLOSE })), { status: 200 });
    await withUpstream(impl, async () => {
      _memory.clear();
      const kv = fakeKv();
      const env = { CACHE: kv, ALLOWED_ORIGINS: "*", DESK_SYMBOLS: "SPY" };
      await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=1Day"), env, {});
      await worker.fetch(new Request("https://api.test/api/bars?symbols=SPY&tf=1Day"), env, {});
      const keys = [...kv.store.keys()].filter((k) => k.startsWith("bars:")).sort();
      assert.deepEqual(
        keys,
        [`${BARS_KEY_PREFIX}:1Day:SPY`, `${BARS_KEY_PREFIX}l:1Day:SPY`],
        "one key cannot hold two histories: the short watchlist range gets its own"
      );
    });
  });

  await test("the daily cron refreshes the desk symbols, and only on its own schedule", async () => {
    let barCalls = 0;
    const impl = async (url) => {
      const u = String(url);
      if (u.includes("/q/d/l/")) {
        barCalls++;
        return new Response(new URL(u).searchParams.get("i") === "d" ? DAILY_CSV : WARSAW_5MIN, { status: 200 });
      }
      if (u.includes("faireconomy")) return new Response(JSON.stringify(CAL), { status: 200 });
      return new Response(RSS, { status: 200 });
    };
    await withUpstream(impl, async () => {
      _memory.clear();
      const kv = fakeKv();
      const env = { CACHE: kv, ALLOWED_ORIGINS: "*", DESK_SYMBOLS: "SPY,QQQ", GEMINI_API_KEY: "" };
      await worker.scheduled({ cron: BARS_CRON }, env, {});
      // Two symbols x two timeframes, and each intraday request also pulls the
      // daily series the desk reads for prior-day levels.
      assert.equal(barCalls, 6, `expected 6 upstream price calls, got ${barCalls}`);
      const keys = [...kv.store.keys()].filter((k) => k.startsWith("bars:"));
      assert.equal(keys.length, 4, JSON.stringify(keys));

      // The 20-minute run refreshes news and the calendar, never prices.
      _memory.clear();
      const before = barCalls;
      await worker.scheduled({ cron: "*/20 * * * *" }, env, {});
      assert.equal(barCalls, before, "the 20-minute run must not re-fetch prices");
    });
  });

  /* ------------------------------------------------------------------ report */
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log(` - ${f.name}: ${(f.error && f.error.message) || f.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("runner error:", e);
  process.exit(2);
});
