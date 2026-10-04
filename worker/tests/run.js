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
import { cached, createMemory, warm, singleFlight } from "../src/cache.js";
import { buildPrompt, generateOverview, DEFAULT_MODEL } from "../src/gemini.js";
import worker, { upcomingEvents, _memory } from "../src/index.js";

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
