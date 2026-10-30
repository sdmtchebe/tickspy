/* Telegram alerts: the engine, the link flow, the bot webhook and the tick.
 *
 *   node tests/alerts.js
 *
 * Everything runs against a real KV stub, the real routing layer and a stubbed
 * network, so these are assertions about behaviour rather than about internals.
 * The stubbed network is a recorder for api.telegram.org: what it captures is
 * exactly what would have gone to Telegram, which is how the tests can check the
 * message copy, the chat id, and that no token ever appears in a reply.
 */
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  LINK_PREFIX,
  MAX_SENDS_PER_TICK,
  REARM_MS,
  _clearQuoteCache,
  cleanRules,
  cleanSymbol,
  dueCalendarAlerts,
  dueNewsAlerts,
  duePriceAlerts,
  rulesAreEmpty,
  rulesSummary,
  runAlertTick,
} from "../src/alerts.js";
import { _clearRateLimits } from "../src/alertapi.js";
import { alertText, escapeHtml, telegramBot } from "../src/telegram.js";

let passed = 0;
const failures = [];
async function test(name, fn) {
  // The per-isolate rate limiter and quote cache are real and shared by every
  // case here, so each case starts from a clean slate rather than inheriting its
  // neighbours' state.
  _clearRateLimits();
  _clearQuoteCache();
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${(e && e.message) || e}`);
  }
}

/* ------------------------------------------------------------- a KV stub --- */

/** Enough of Workers KV to run the real code paths, including list and delete. */
function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return v;
    },
    async put(key, value, opts) {
      store.set(key, String(value));
      void opts;
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "", limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return {
        keys: keys.slice(0, limit).map((name) => ({ name })),
        list_complete: keys.length <= limit,
        cursor: undefined,
      };
    },
  };
}

/* A syntactically valid bot token, generated here so no real secret is in the
 * repo. The Bot API is never called: every send is recorded instead. */
const BOT_TOKEN = "123456789:" + "A".repeat(35);
const BOT_USERNAME = "tickspy_alerts_bot";
const SECRET = "test-webhook-secret-0123456789";
const CHAT = "987654321";

function testEnv(extra = {}) {
  return {
    CACHE: fakeKV(),
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    PUBLIC_SITE_URL: "https://tickspy.com",
    ALLOWED_ORIGINS: "https://tickspy.com",
    ...extra,
  };
}

const ORIGIN = "https://tickspy.com";
const CTX = { waitUntil() {}, passThroughOnException() {} };

/** Call the Worker the way a browser does. */
async function call(env, { method = "GET", path, body, origin = ORIGIN, text = null, headers = {} }) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined || text !== null) h["Content-Type"] = "application/json";
  const req = new Request(`https://worker.test${path}`, {
    method,
    headers: h,
    body: text !== null ? text : body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, CTX);
  return { res, json: await res.json().catch(() => null) };
}

/** A fetch stub that records what would have gone to the Bot API. */
function telegramRecorder({ status = 200, description = "" } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    calls.push({ url: String(url), body });
    const payload =
      status === 200
        ? { ok: true, result: { message_id: 1, chat: { id: Number(body && body.chat_id) } } }
        : { ok: false, description: description || "Forbidden: bot was blocked by the user" };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  fetcher.calls = calls;
  return fetcher;
}

/** Run `fn` with the global fetch replaced, so nothing reaches the network. */
async function withGlobalFetch(fetcher, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** One Telegram update, shaped exactly as the Bot API delivers it. */
const update = (chatId, text) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(chatId), type: "private", first_name: "Test", username: "tester" },
    from: { id: Number(chatId), is_bot: false, first_name: "Test" },
    text,
  },
});

/** Press Start in the chat, the way Telegram would. */
async function botMessage(env, text, { chatId = CHAT, secret = SECRET, recorder } = {}) {
  const calls = recorder || telegramRecorder();
  const out = await withGlobalFetch(calls, () =>
    call(env, {
      method: "POST",
      path: "/api/telegram/webhook",
      origin: null,
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
      body: update(chatId, text),
    })
  );
  return { ...out, sent: calls.calls.map((c) => c.body || {}) };
}

/** Make a link code and consume it, returning the desk's credentials. */
async function linkChat(env, { chatId = CHAT, rules = {} } = {}) {
  const started = await call(env, { method: "POST", path: "/api/alerts/link/start", body: { rules } });
  assert.equal(started.res.status, 200, "the link code was not issued");
  const code = started.json.code;
  await botMessage(env, `/start ${code}`, { chatId });
  const status = await call(env, { method: "GET", path: `/api/alerts/link/status?code=${code}`, origin: null });
  assert.equal(status.json.linked, true, "the chat was not linked by the webhook");
  return { code, id: status.json.id, token: status.json.token, chatId: String(chatId) };
}

/** Seed a subscription directly, for the tick tests. */
async function seed(env, { chatId = CHAT, rules = {}, fired = {} } = {}) {
  const id = "a".repeat(31) + String(Math.floor(Math.random() * 10));
  const rec = {
    id,
    token: "t".repeat(48),
    chatId: String(chatId),
    chatLabel: "Test chat",
    rules: cleanRules(rules),
    createdAt: new Date().toISOString(),
    fired,
  };
  env.CACHE.store.set(`alert:${id}`, JSON.stringify(rec));
  env.CACHE.store.set(`tgchat:${chatId}`, id);
  return rec;
}

/** One fetch stub for both upstreams a tick touches: quotes and Telegram. */
function tickNet({ price = null, telegramStatus = 200, description = "" } = {}) {
  const telegram = telegramRecorder({ status: telegramStatus, description });
  const fetcher = async (url, init) => {
    if (String(url).includes("finance.yahoo.com")) {
      if (price == null) return new Response("no", { status: 500 });
      return new Response(
        JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price }, indicators: { quote: [{ close: [price] }] } }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return telegram(url, init);
  };
  fetcher.telegram = telegram;
  return fetcher;
}

/* ------------------------------------------------------------ validation --- */

console.log("\nRules validation\n");

await test("bounds and drops anything malformed", () => {
  const r = cleanRules({
    price: [
      { sym: "spy", type: "above", val: 600.556 },
      { sym: "spy", type: "sideways", val: 1 },
      { sym: "", type: "above", val: 1 },
      { sym: "QQQ", type: "below", val: -3 },
      { sym: "NVDA", type: "below", val: 120 },
    ],
    news: { on: 1, symbols: ["nvda", "NVDA", "!!!"] },
    calendar: { on: "yes", impact: "everything", lead: 500, releases: 1 },
    unexpected: { deeply: "ignored" },
  });
  assert.deepEqual(r.price, [
    { sym: "SPY", type: "above", val: 600.56 },
    { sym: "NVDA", type: "below", val: 120 },
  ]);
  assert.deepEqual(r.news, { on: true, symbols: ["NVDA"], keywords: [], mute: [] });
  assert.deepEqual(r.calendar, { on: true, impact: "High", lead: 120, releases: true, keywords: [], mute: [] });
  // A record with no move, quiet or pacing section still loads with every
  // default, which is what keeps older saved rules working.
  assert.deepEqual(r.moves, { on: false, up: 2, down: 2, window: 15, symbols: [] });
  assert.deepEqual(r.quiet, { on: false, from: "22:00", to: "07:00", tz: "UTC" });
  assert.equal(r.rearm, 30);
  assert.equal(r.paused, false);
});

await test("caps arrays and clamps every numeric field", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ sym: `S${i}`, type: "above", val: 1 }));
  const r = cleanRules({
    price: many,
    moves: { on: true, up: 900, down: -4, window: 9999, symbols: ["spy", "spy", "bad symbol"] },
    news: { symbols: "not-an-array" },
    calendar: { lead: 0, impact: "whatever" },
    quiet: { from: "25:99", to: "6:5", tz: "Not/AZone" },
    rearm: 1,
  });
  assert.equal(r.price.length, 20);
  assert.deepEqual(r.news.symbols, []);
  // A lead of 0 is out of range, not "off" — off is `on: false`. It clamps to
  // the shortest lead the desk can offer rather than silently becoming 15.
  assert.equal(r.calendar.lead, 1);
  assert.equal(r.calendar.impact, "High");
  assert.equal(r.calendar.on, false);
  assert.equal(r.moves.up, 25);
  assert.equal(r.moves.down, 0.1);
  assert.equal(r.moves.window, 120);
  assert.deepEqual(r.moves.symbols, ["SPY"]);
  // Malformed times and an unknown zone fall back rather than throwing: quiet
  // hours that cannot be evaluated must never silence someone by accident.
  assert.equal(r.quiet.from, "22:00");
  assert.equal(r.quiet.to, "07:00");
  assert.equal(r.quiet.tz, "UTC");
  assert.equal(r.rearm, 10);
});

await test("accepts every percent, move and word control a person can set", () => {
  const r = cleanRules({
    price: [
      { sym: "SPY", type: "pct_up", val: 2.06 },
      { sym: "QQQ", type: "pct_down", val: 500 },
    ],
    moves: { on: true, up: 1.5, down: 2.5, window: 10, symbols: ["NVDA"] },
    news: { on: true, symbols: ["spy"], keywords: ["Fed", "fed", "earnings"], mute: ["sponsored"] },
    calendar: { on: true, impact: "All", lead: 45, releases: true, keywords: ["CPI"], mute: ["speech"] },
    quiet: { on: true, from: "21:30", to: "06:15", tz: "America/Toronto" },
    rearm: 45,
    paused: true,
  });
  assert.deepEqual(r.price, [
    { sym: "SPY", type: "pct_up", val: 2.1 },
    { sym: "QQQ", type: "pct_down", val: 50 },
  ]);
  assert.equal(r.moves.on, true);
  assert.deepEqual(r.moves.symbols, ["NVDA"]);
  assert.deepEqual(r.news.keywords, ["Fed", "earnings"], "a duplicate keyword was kept");
  assert.deepEqual(r.news.mute, ["sponsored"]);
  assert.equal(r.calendar.impact, "All");
  assert.deepEqual(r.calendar.keywords, ["CPI"]);
  assert.deepEqual(r.quiet, { on: true, from: "21:30", to: "06:15", tz: "America/Toronto" });
  assert.equal(r.rearm, 45);
  assert.equal(r.paused, true);
});

await test("word filters keep words, not markup", () => {
  const r = cleanRules({ news: { on: true, keywords: ["  Fed  ", "<b>x</b>", "!!!", "a".repeat(80)] } });
  assert.deepEqual(r.news.keywords, ["Fed", "a".repeat(24)]);
});

await test("an unknown rule type is dropped, not stored", () => {
  const r = cleanRules({ price: [{ sym: "SPY", type: "sideways", val: 3 }, { sym: "SPY", type: "pct_up", val: 2 }] });
  assert.deepEqual(r.price, [{ sym: "SPY", type: "pct_up", val: 2 }]);
});

await test("rejects a non-object without throwing", () => {
  for (const bad of [null, undefined, 42, "x", [], true]) {
    const r = cleanRules(bad);
    assert.deepEqual(r, cleanRules({}));
    assert.equal(rulesAreEmpty(r), true);
  }
});

await test("cleanSymbol accepts real tickers and refuses anything else", () => {
  assert.equal(cleanSymbol("spy"), "SPY");
  assert.equal(cleanSymbol("brk.b"), "BRK.B");
  assert.equal(cleanSymbol("a b"), null);
  // A leading ^ is an index in some providers and a prefix operator in others;
  // the desk does not trade indices, so the symbol rule starts at a letter or
  // digit and this is refused on purpose.
  assert.equal(cleanSymbol("^gspc"), null);
  assert.equal(cleanSymbol("<script>"), null);
  assert.equal(cleanSymbol("x".repeat(13)), null);
});

await test("rulesSummary is the one description both surfaces use", () => {
  const lines = rulesSummary(
    cleanRules({
      price: [{ sym: "SPY", type: "above", val: 550 }, { sym: "QQQ", type: "pct_down", val: 3 }],
      moves: { on: true, up: 1.5, down: 2.5, window: 10, symbols: [] },
      news: { on: true, symbols: ["NVDA"], keywords: ["Fed"], mute: ["recap"] },
      calendar: { on: true, impact: "HighMedium", lead: 20, releases: true, keywords: ["CPI"] },
      quiet: { on: true, from: "22:00", to: "07:00", tz: "America/Toronto" },
      rearm: 45,
      paused: true,
    })
  );
  assert.deepEqual(lines, [
    "Paused — nothing will be sent",
    "SPY above 550.00",
    "QQQ down 3% from the previous close",
    "Moves of +1.5% or -2.5% within 10 min (the desk's default symbols)",
    "Headlines mentioning NVDA; containing Fed; never recap",
    "High and medium-impact events · 20 min before · and on release · titled CPI",
    "Quiet hours 22:00–07:00 (America/Toronto)",
    "Cooldown 45 min",
  ]);
});

/* -------------------------------------------------------------- telegram --- */

console.log("\nTelegram transport\n");

await test("a bot needs both a token and a username", () => {
  assert.equal(telegramBot({}), null);
  assert.equal(telegramBot({ TELEGRAM_BOT_TOKEN: "nope", TELEGRAM_BOT_USERNAME: "tickspy_alerts_bot" }), null);
  assert.equal(telegramBot({ TELEGRAM_BOT_TOKEN: BOT_TOKEN }), null);
  assert.deepEqual(telegramBot({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_BOT_USERNAME: "@" + BOT_USERNAME }), {
    token: BOT_TOKEN,
    username: BOT_USERNAME,
  });
});

await test("message copy escapes anything a headline could contain", () => {
  const text = alertText("news", { items: [{ title: "<b>SPY</b> & <script>alert(1)</script>" }] }, { PUBLIC_SITE_URL: "https://tickspy.com" });
  assert.ok(!text.includes("<script>"), "a raw script tag reached the message");
  assert.ok(text.includes("&lt;b&gt;SPY&lt;/b&gt;"));
  assert.ok(text.includes("&amp;"));
  assert.ok(text.includes("https://tickspy.com/desk/"));
  assert.equal(escapeHtml(`a"b'c`), "a&quot;b'c");
});

await test("a price alert reads as a statement of fact", () => {
  const text = alertText("price", { sym: "SPY", type: "below", val: 500, price: 499.5 }, {});
  assert.ok(text.includes("SPY is below 500.00"));
  assert.ok(text.includes("Now 499.50"));
  assert.ok(!/buy|sell|recommend/i.test(text));
});

await test("a percent rule and a big move read differently from a level", () => {
  const pct = alertText("price", { sym: "SPY", type: "pct_up", val: 2, price: 512.3, prevClose: 499.8, pct: 2.5 }, {});
  assert.ok(pct.includes("SPY is up 2.5% today"));
  assert.ok(pct.includes("previous close 499.80"));

  const jump = alertText("move", { sym: "NVDA", dir: "up", pct: 1.84, window: 15, threshold: 1.5, price: 120.4, from: 118.2 }, {});
  assert.ok(jump.includes("NVDA jumped 1.8% in 15 min"));
  assert.ok(jump.includes("Your rule: jumps of 1.5% or more."));

  const drop = alertText("move", { sym: "SPY", dir: "down", pct: -2.2, window: 5, threshold: 2, price: 490, from: 501 }, {});
  assert.ok(drop.includes("SPY dropped 2.2% in 5 min"));
  assert.ok(!/buy|sell|recommend/i.test(drop));
});

/* ------------------------------------------------------------ evaluation --- */

console.log("\nEvaluation\n");

await test("a price rule fires when crossed, then goes quiet for the re-arm", () => {
  const rules = [{ sym: "SPY", type: "above", val: 100 }];
  const t0 = 1_700_000_000_000;
  const first = duePriceAlerts(rules, { SPY: 101 }, {}, t0);
  assert.equal(first.length, 1);
  assert.equal(first[0].key, "price:SPY:above:100");

  const fired = { [first[0].key]: t0 };
  assert.equal(duePriceAlerts(rules, { SPY: 102 }, fired, t0 + 60_000).length, 0, "it fired again inside the re-arm window");
  assert.equal(duePriceAlerts(rules, { SPY: 102 }, fired, t0 + REARM_MS + 1).length, 1, "it never re-armed");
});

await test("a rule that is not true never fires, and a missing quote is skipped", () => {
  const rules = [{ sym: "SPY", type: "above", val: 500 }];
  assert.equal(duePriceAlerts(rules, { SPY: 499 }, {}, 1).length, 0);
  assert.equal(duePriceAlerts(rules, {}, {}, 1).length, 0);
  assert.equal(duePriceAlerts([{ sym: "qqq", type: "below", val: 400 }], { QQQ: 399 }, {}, 1).length, 1);
});

await test("calendar rules respect the lead window, the impact filter and releases", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const events = [
    { title: "CPI", date: "2026-10-21T12:10:00Z", impact: "High", forecast: "3.1%" },
    { title: "Jobless claims", date: "2026-10-21T12:10:00Z", impact: "Medium", forecast: "220K" },
    { title: "Far away", date: "2026-10-21T18:00:00Z", impact: "High" },
    { title: "Released", date: "2026-10-21T11:50:00Z", impact: "High", actual: "3.4%", forecast: "3.1%" },
  ];
  const high = dueCalendarAlerts({ on: true, impact: "High", lead: 15, releases: false }, events, {}, now);
  assert.deepEqual(high.map((e) => e.title), ["CPI"]);

  const both = dueCalendarAlerts({ on: true, impact: "HighMedium", lead: 15, releases: false }, events, {}, now);
  assert.deepEqual(both.map((e) => e.title).sort(), ["CPI", "Jobless claims"]);

  const withReleases = dueCalendarAlerts({ on: true, impact: "High", lead: 15, releases: true }, events, {}, now);
  assert.deepEqual(withReleases.map((e) => e.kind).sort(), ["released", "soon"]);

  // Off is off, whatever the events say.
  assert.equal(dueCalendarAlerts({ on: false, impact: "High", lead: 15, releases: true }, events, {}, now).length, 0);
});

await test("headlines match a symbol, stay inside the window, and are capped", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const headlines = [
    { title: "NVDA jumps on demand", publishedAt: iso(now - 60_000) },
    { title: "Something else", publishedAt: iso(now - 60_000) },
    { title: "NVDA again", publishedAt: iso(now - 120_000) },
    { title: "Old NVDA news", publishedAt: iso(now - 90 * 60_000) },
  ];
  const hits = dueNewsAlerts({ on: true, symbols: ["NVDA"] }, headlines, now);
  assert.deepEqual(hits.map((h) => h.title), ["NVDA jumps on demand", "NVDA again"]);

  // No symbols chosen means "the main market headlines", still inside the window.
  const all = dueNewsAlerts({ on: true, symbols: [] }, headlines, now);
  assert.equal(all.length, 3);

  // Never more than four in one tick: a chat that buzzes repeatedly gets muted.
  const many = Array.from({ length: 10 }, (_, i) => ({ title: `NVDA ${i}`, publishedAt: iso(now - 1000 * (i + 1)) }));
  assert.equal(dueNewsAlerts({ on: true, symbols: ["NVDA"] }, many, now).length, 4);

  assert.equal(dueNewsAlerts({ on: false, symbols: ["NVDA"] }, headlines, now).length, 0);
});

/* ---------------------------------------------------------------- tick ---- */

console.log("\nThe tick\n");

await test("a quiet tick with no subscribers is configured and does nothing", async () => {
  const env = testEnv();
  const net = tickNet();
  const summary = await runAlertTick({ env, fetcher: net });
  assert.equal(summary.configured, true);
  assert.equal(summary.checked, 0);
  assert.equal(summary.sent, 0);
  assert.equal(net.telegram.calls.length, 0);
});

await test("an unconfigured deployment says so instead of pretending", async () => {
  const env = { CACHE: fakeKV() };
  const summary = await runAlertTick({ env, fetcher: tickNet() });
  assert.equal(summary.configured, false);
  assert.match(summary.errors.join(" "), /not configured/i);
});

await test("a crossed price rule sends one message, with the chat id and no token", async () => {
  const env = testEnv();
  await seed(env, { rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const net = tickNet({ price: 501.25 });

  const summary = await runAlertTick({ env, fetcher: net });
  assert.equal(summary.checked, 1);
  assert.equal(summary.sent, 1);

  const call0 = net.telegram.calls[0];
  assert.match(call0.url, /api\.telegram\.org\/bot123456789:A+\/sendMessage$/);
  assert.equal(call0.body.chat_id, CHAT);
  assert.equal(call0.body.parse_mode, "HTML");
  assert.ok(call0.body.text.includes("SPY is above 500.00"));
  assert.ok(!JSON.stringify(call0.body).includes(BOT_TOKEN), "the token was placed in the body");
  assert.ok(!JSON.stringify(net.telegram.calls.map((c) => c.url)).includes("123456789:" + "A".repeat(35) + "/sendMessage?"));
});

await test("the same rule does not fire twice inside the re-arm, and fires again after it", async () => {
  const env = testEnv();
  const rec = await seed(env, { rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  let clock = 1_700_000_000_000;
  const now = () => clock;

  const first = await runAlertTick({ env, now, fetcher: tickNet({ price: 505 }) });
  assert.equal(first.sent, 1);

  clock += 60_000;
  const second = await runAlertTick({ env, now, fetcher: tickNet({ price: 506 }) });
  assert.equal(second.sent, 0, "a still-true rule notified again inside the window");

  clock += REARM_MS + 1000;
  const third = await runAlertTick({ env, now, fetcher: tickNet({ price: 507 }) });
  assert.equal(third.sent, 1, "the rule never re-armed");

  // The record remembers when it last fired, so a restart does not re-send.
  const stored = JSON.parse(env.CACHE.store.get(`alert:${rec.id}`));
  assert.ok(stored.fired["price:SPY:above:500"] > 1_700_000_000_000);
  assert.match(stored.lastSentAt, /^\d{4}-\d{2}-\d{2}T/);
});

await test("a calendar alert and a headline alert both arrive in one message each", async () => {
  const env = testEnv();
  const now = Date.parse("2026-10-21T12:00:00Z");
  await seed(env, {
    rules: { news: { on: true, symbols: ["NVDA"] }, calendar: { on: true, impact: "High", lead: 15, releases: false } },
  });
  const net = tickNet();
  const summary = await runAlertTick({
    env,
    now: () => now,
    fetcher: net,
    news: [{ title: "NVDA rallies", publishedAt: new Date(now - 60_000).toISOString() }],
    events: [{ title: "CPI", date: new Date(now + 10 * 60_000).toISOString(), impact: "High", forecast: "3.1%" }],
  });
  assert.equal(summary.sent, 2);
  const texts = net.telegram.calls.map((c) => c.body.text).join("\n");
  assert.ok(texts.includes("NVDA rallies"));
  assert.ok(texts.includes("CPI"));
  assert.ok(texts.includes("in 10 min"));
});

await test("a blocked bot deletes the record instead of retrying for ever", async () => {
  const env = testEnv();
  const rec = await seed(env, { rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const summary = await runAlertTick({ env, fetcher: tickNet({ price: 501, telegramStatus: 403 }) });
  assert.equal(summary.removed, 1);
  assert.equal(env.CACHE.store.has(`alert:${rec.id}`), false);
  assert.equal(env.CACHE.store.has(`tgchat:${CHAT}`), false, "the chat index outlived the record");
});

await test("a transient failure is kept and retried on the next tick", async () => {
  const env = testEnv();
  const rec = await seed(env, { rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const summary = await runAlertTick({ env, fetcher: tickNet({ price: 501, telegramStatus: 500, description: "Internal Server Error" }) });
  assert.equal(summary.sent, 0);
  assert.equal(summary.removed, 0);
  assert.ok(summary.errors.some((e) => /send_failed/.test(e)), `the failure was not reported: ${summary.errors.join(", ")}`);
  assert.equal(env.CACHE.store.has(`alert:${rec.id}`), true, "a bad minute unsubscribed someone");
});

await test("one tick never sends more than its limit, and defers the rest", async () => {
  const env = testEnv();
  await seed(env, { chatId: "111", rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  await seed(env, { chatId: "222", rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const net = tickNet({ price: 501 });
  const summary = await runAlertTick({ env, fetcher: net, limit: 1 });
  assert.equal(summary.sent, 1);
  assert.equal(summary.checked, 2);
  assert.equal(summary.skipped, 1);
  assert.ok(MAX_SENDS_PER_TICK >= 1);
});

await test("a record with no chat id is not a subscriber", async () => {
  const env = testEnv();
  env.CACHE.store.set(
    "alert:" + "b".repeat(32),
    JSON.stringify({ id: "b".repeat(32), token: "t", rules: cleanRules({ price: [{ sym: "SPY", type: "above", val: 1 }] }) })
  );
  const summary = await runAlertTick({ env, fetcher: tickNet({ price: 900 }) });
  assert.equal(summary.checked, 0);
  assert.equal(summary.sent, 0);
});

/* --------------------------------------------------------------- the API --- */

console.log("\nThe API\n");

await test("config reports what the deployment can do, and why not when it cannot", async () => {
  const ready = await call(testEnv(), { path: "/api/alerts/config" });
  assert.equal(ready.res.status, 200);
  assert.equal(ready.json.telegram, true);
  assert.equal(ready.json.botUsername, BOT_USERNAME);
  assert.equal(ready.json.tickMinutes, 5);
  assert.equal(ready.json.linkTtlMinutes, 15);

  const off = await call(testEnv({ TELEGRAM_BOT_TOKEN: "" }), { path: "/api/alerts/config" });
  assert.equal(off.json.telegram, false);
  assert.equal(off.json.botUsername, null);
  assert.match(off.json.note, /bot token/i);
});

await test("the link endpoints refuse a foreign origin and a bare POST", async () => {
  const env = testEnv();
  const cross = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {}, origin: "https://evil.example" });
  assert.equal(cross.res.status, 403);
  assert.equal(cross.json.error, "forbidden_origin");

  const none = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {}, origin: null });
  assert.equal(none.res.status, 403);

  const get = await call(env, { method: "GET", path: "/api/alerts/link/start" });
  assert.equal(get.res.status, 405);
});

await test("link/start issues a 32-hex code and a deep link to the configured bot", async () => {
  const env = testEnv();
  const r = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {} });
  assert.equal(r.res.status, 200);
  assert.match(r.json.code, /^[0-9a-f]{32}$/);
  assert.equal(r.json.botUsername, BOT_USERNAME);
  assert.equal(r.json.deepLink, `https://t.me/${BOT_USERNAME}?start=${r.json.code}`);
  assert.ok(r.json.ttlMinutes === 15);
  assert.ok(env.CACHE.store.has(LINK_PREFIX + r.json.code));
});

await test("an unconfigured deployment refuses to issue a code", async () => {
  const env = testEnv({ TELEGRAM_BOT_TOKEN: "" });
  const r = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {} });
  assert.equal(r.res.status, 503);
  assert.equal(r.json.error, "not_configured");
});

await test("the webhook refuses calls without the secret header", async () => {
  const env = testEnv();
  const none = await call(env, { method: "POST", path: "/api/telegram/webhook", origin: null, body: update(CHAT, "/start") });
  assert.equal(none.res.status, 401);

  const wrong = await call(env, {
    method: "POST",
    path: "/api/telegram/webhook",
    origin: null,
    headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
    body: update(CHAT, "/start"),
  });
  assert.equal(wrong.res.status, 401);

  // A deployment with no secret at all cannot authenticate anyone, so it refuses.
  const noSecret = testEnv({ TELEGRAM_WEBHOOK_SECRET: "" });
  const refused = await botMessage(noSecret, "/start", { secret: "" });
  assert.equal(refused.res.status, 401);
});

await test("pressing Start with a code links the chat and hands the desk its credentials", async () => {
  const env = testEnv();
  const started = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {} });
  const code = started.json.code;

  const started2 = await botMessage(env, `/start ${code}`);
  assert.equal(started2.res.status, 200);
  assert.equal(started2.sent[0].chat_id, CHAT);
  assert.match(started2.sent[0].text, /Connected/);

  const status = await call(env, { method: "GET", path: `/api/alerts/link/status?code=${code}`, origin: null });
  assert.equal(status.json.linked, true);
  assert.match(status.json.id, /^[0-9a-f]{32}$/);
  assert.match(status.json.token, /^[0-9a-f]{48}$/);
  assert.equal(status.json.subscription.channel, "telegram");
  assert.equal(JSON.stringify(status.json).includes(CHAT), false, "the chat id leaked to the desk");

  // The record really is in the store, under the chat index too.
  assert.ok(env.CACHE.store.has(`alert:${status.json.id}`));
  assert.equal(env.CACHE.store.get(`tgchat:${CHAT}`), status.json.id);
});

await test("a code that was never issued, and a code already used by another chat, do not link", async () => {
  const env = testEnv();
  const unknown = await botMessage(env, "/start " + "f".repeat(32));
  assert.match(unknown.sent[0].text, /expired/i);
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 0);

  const creds = await linkChat(env, { chatId: "111" });
  const other = await botMessage(env, `/start ${creds.code}`, { chatId: "222" });
  assert.match(other.sent[0].text, /expired/i);
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 1);
  assert.equal(env.CACHE.store.has("tgchat:222"), false);
});

await test("the same chat pressing a fresh code keeps its record and its rules", async () => {
  const env = testEnv();
  const first = await linkChat(env, { chatId: CHAT, rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const second = await linkChat(env, { chatId: CHAT });
  assert.equal(second.id, first.id, "re-linking created a second record for the same chat");
  const stored = JSON.parse(env.CACHE.store.get(`alert:${first.id}`));
  assert.equal(stored.rules.price[0].sym, "SPY", "re-linking silently dropped the rules");
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 1);
});

await test("the same chat pressing the same code twice is not an error", async () => {
  const env = testEnv();
  const started = await call(env, { method: "POST", path: "/api/alerts/link/start", body: {} });
  await botMessage(env, `/start ${started.json.code}`);
  const again = await botMessage(env, `/start ${started.json.code}`);
  assert.equal(again.res.status, 200);
  assert.match(again.sent[0].text, /Connected/);
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 1);
});

await test("a bare /start, an unknown command and /help all explain how to connect", async () => {
  const env = testEnv();
  const bare = await botMessage(env, "/start");
  assert.match(bare.sent[0].text, /Connect Telegram/);
  const unknown = await botMessage(env, "hello?");
  assert.equal(unknown.res.status, 200);
  assert.match(unknown.sent[0].text, /Connect Telegram/);
  const help = await botMessage(env, "/help@TickSPYAlertsBot");
  assert.match(help.sent[0].text, /Connect Telegram/);
  // Nothing was created by any of them.
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 0);
});

await test("rules are saved with the id and token, and refused without them", async () => {
  const env = testEnv();
  const { id, token } = await linkChat(env);

  const saved = await call(env, {
    method: "POST",
    path: "/api/alerts/rules",
    body: { id, token, rules: { price: [{ sym: "qqq", type: "below", val: 400.555 }] } },
  });
  assert.equal(saved.res.status, 200);
  assert.deepEqual(saved.json.subscription.rules.price, [{ sym: "QQQ", type: "below", val: 400.56 }]);

  const wrong = await call(env, { method: "POST", path: "/api/alerts/rules", body: { id, token: "0".repeat(48), rules: {} } });
  assert.equal(wrong.res.status, 404);

  const malformed = await call(env, { method: "POST", path: "/api/alerts/rules", body: { id: "nope", token, rules: {} } });
  assert.equal(malformed.res.status, 400);

  const foreign = await call(env, {
    method: "POST",
    path: "/api/alerts/rules",
    body: { id, token, rules: {} },
    origin: "https://evil.example",
  });
  assert.equal(foreign.res.status, 403);
});

await test("the test route sends one message and reports a blocked bot as gone", async () => {
  const env = testEnv();
  const { id, token } = await linkChat(env);

  const ok = telegramRecorder();
  const sent = await withGlobalFetch(ok, () => call(env, { method: "POST", path: "/api/alerts/test", body: { id, token } }));
  assert.equal(sent.res.status, 200);
  assert.equal(sent.json.sent, "telegram");
  assert.equal(ok.calls[0].body.chat_id, CHAT);
  assert.match(ok.calls[0].body.text, /working/);

  const blocked = telegramRecorder({ status: 403 });
  const gone = await withGlobalFetch(blocked, () => call(env, { method: "POST", path: "/api/alerts/test", body: { id, token } }));
  assert.equal(gone.res.status, 410);
  assert.equal(env.CACHE.store.has(`alert:${id}`), false);
});

await test("a test cannot be used to spam a chat", async () => {
  const env = testEnv();
  const { id, token } = await linkChat(env);
  const recorder = telegramRecorder();
  const press = () =>
    withGlobalFetch(recorder, () => call(env, { method: "POST", path: "/api/alerts/test", body: { id, token } }));
  // Three in a minute is allowed (a mistyped chat, a retry, a second device);
  // the fourth inside the same window is refused.
  for (let i = 0; i < 3; i++) assert.equal((await press()).res.status, 200);
  assert.equal((await press()).res.status, 429);
});

await test("disconnecting deletes the record, and /stop does the same", async () => {
  const env = testEnv();
  const one = await linkChat(env);
  const off = await withGlobalFetch(telegramRecorder(), () =>
    call(env, { method: "POST", path: "/api/alerts/unsubscribe", body: { id: one.id, token: one.token } })
  );
  assert.equal(off.res.status, 200);
  assert.equal(env.CACHE.store.has(`alert:${one.id}`), false);

  await linkChat(env);
  const stopped = await botMessage(env, "/stop");
  assert.match(stopped.sent[0].text, /Disconnected/);
  assert.equal([...env.CACHE.store.keys()].filter((k) => k.startsWith("alert:")).length, 0);
  assert.equal(env.CACHE.store.has(`tgchat:${CHAT}`), false);
});

await test("/rules shows the same sentences the desk shows", async () => {
  const env = testEnv();
  await linkChat(env, { rules: { price: [{ sym: "SPY", type: "above", val: 500 }] } });
  const r = await botMessage(env, "/rules");
  assert.match(r.sent[0].text, /SPY above 500\.00/);
});

await test("/test in the chat sends a test, and /rules before linking explains why not", async () => {
  const env = testEnv();
  const before = await botMessage(env, "/test");
  assert.match(before.sent[0].text, /not connected/i);

  await linkChat(env);
  const after = await botMessage(env, "/test");
  assert.match(after.sent[0].text, /working/);
});

/* --------------------------------------------------------------- helpers -- */

console.log("\nHelpers\n");

await test("the webhook tolerates junk without a 5xx, so Telegram does not retry", async () => {
  const env = testEnv();
  const headers = { "X-Telegram-Bot-Api-Secret-Token": SECRET };

  const notJson = await call(env, { method: "POST", path: "/api/telegram/webhook", origin: null, headers, text: "{oops" });
  assert.equal(notJson.res.status, 200);

  const empty = await call(env, { method: "POST", path: "/api/telegram/webhook", origin: null, headers, body: {} });
  assert.equal(empty.res.status, 200);

  const noChat = await call(env, {
    method: "POST",
    path: "/api/telegram/webhook",
    origin: null,
    headers,
    body: { update_id: 2, edited_message: { message_id: 1, text: "/start" } },
  });
  assert.equal(noChat.res.status, 200);
});

await test("every message carries the desk link from PUBLIC_SITE_URL", () => {
  const text = alertText("test", {}, { PUBLIC_SITE_URL: "https://example.test/" });
  assert.ok(text.includes("https://example.test/desk/"), "the trailing slash was not normalised");
});

/* ------------------------------------------------------------------ done -- */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
