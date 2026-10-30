/* Live check against a locally running `wrangler dev` Worker (workerd + local KV).
 *
 *   cd worker && node scripts/live-check.mjs
 *
 * The Node test suites stub the network and run the code in Node. This drives the
 * same endpoints inside the real runtime, with a real KV namespace, so it catches
 * what only workerd can catch: a module the runtime refuses to load, a binding it
 * cannot resolve, a header it rejects, a Request body it will not re-read.
 *
 * The Telegram bot here is a stub token in .dev.vars, so the sends are expected
 * to fail — the point is that they fail as a reported 502 rather than a crash,
 * and that everything up to the send (link code, webhook authentication, the
 * link itself, the rules write) works in the real runtime.
 *
 * What it needs in worker/.dev.vars (git-ignored, local only):
 *   TELEGRAM_BOT_TOKEN = a syntactically valid fake token, e.g. 123456789:AAAA...
 *   TELEGRAM_WEBHOOK_SECRET = webhook-check-secret-0123456789
 * See README.md, "Local development".
 */

const BASE = process.env.BASE || "http://127.0.0.1:8791";
const ORIGIN = "https://tickspy.com";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "webhook-check-secret-0123456789";

async function call(path, { method = "POST", body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* left null: the caller reports the status and the raw text */
  }
  return { status: res.status, json, text, cors: res.headers.get("Access-Control-Allow-Origin") };
}

/** A Telegram update, shaped exactly as the Bot API delivers one. */
const update = (chatId, text) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: "private", first_name: "Live", username: "live_check" },
    from: { id: chatId, is_bot: false, first_name: "Live" },
    text,
  },
});

const out = [];
const note = (ok, label, detail = "") => {
  out.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`live check against ${BASE}\n`);

// 1. Config: the desk renders its whole Alerts tab from this.
const cfg = await call("/api/alerts/config", { method: "GET" });
note(
  cfg.status === 200 && cfg.json.telegram === true && Boolean(cfg.json.botUsername),
  "/api/alerts/config reports Telegram ready, with a bot username",
  `status ${cfg.status} · telegram ${cfg.json?.telegram} · @${cfg.json?.botUsername || "?"}`
);

// 2. The webhook refuses a caller without the secret header.
const unsigned = await call("/api/telegram/webhook", { body: update(4242, "/start"), origin: null });
note(unsigned.status === 401, "a webhook call without the secret is refused", `status ${unsigned.status}`);

const wrongSecret = await call("/api/telegram/webhook", {
  body: update(4242, "/start"),
  origin: null,
  headers: { "X-Telegram-Bot-Api-Secret-Token": "not-the-secret" },
});
note(wrongSecret.status === 401, "a webhook call with the wrong secret is refused", `status ${wrongSecret.status}`);

// 3. The desk's POSTs are origin-gated.
const crossStart = await call("/api/alerts/link/start", { body: {}, origin: "https://evil.example" });
note(crossStart.status === 403, "a cross-site link code request is refused", `status ${crossStart.status} ${crossStart.json?.error || ""}`);

const noOrigin = await call("/api/alerts/link/start", { body: {}, origin: null });
note(noOrigin.status === 403, "a link code request with no Origin is refused", `status ${noOrigin.status}`);

// 4. A link code, and the deep link built from it.
const started = await call("/api/alerts/link/start", { body: {} });
const code = started.json?.code;
note(
  started.status === 200 && /^[0-9a-f]{32}$/.test(code || ""),
  "a one-time link code is issued",
  `status ${started.status} · ${String(code || "").slice(0, 8)}…`
);
note(
  String(started.json?.deepLink || "").includes("?start=" + code),
  "the deep link carries the code",
  started.json?.deepLink
);

// 5. Nothing is linked until the bot consumes it.
const pending = await call(`/api/alerts/link/status?code=${code}`, { method: "GET", origin: null });
note(pending.status === 200 && pending.json?.linked === false, "the code starts out unlinked", `linked ${pending.json?.linked}`);

// 6. Press Start: the real webhook path, in workerd, with the secret header.
const consumed = await call("/api/telegram/webhook", {
  body: update(987654321, `/start ${code}`),
  origin: null,
  headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET },
});
note(
  consumed.status === 200 && consumed.json?.ok === true,
  "the webhook accepts /start <code> and answers 200",
  `status ${consumed.status}`
);

// 7. The desk's poll now picks up the credentials.
const linked = await call(`/api/alerts/link/status?code=${code}`, { method: "GET", origin: null });
const { id, token } = linked.json || {};
note(
  linked.json?.linked === true && /^[0-9a-f]{32}$/.test(id || "") && Boolean(token),
  "the poll returns the subscription id and its token",
  `id ${String(id || "").slice(0, 8)}…`
);
note(
  linked.cors === null,
  "the poll's reply grants no CORS to an originless caller",
  `grant ${linked.cors}`
);

// 8. A wrong token cannot touch the record.
const wrong = await call("/api/alerts/rules", { body: { id, token: "0".repeat(48), rules: {} } });
note(wrong.status === 404, "a wrong token is refused", `status ${wrong.status}`);

// 9. Rules are saved and echoed back normalised.
const rules = await call("/api/alerts/rules", {
  body: { id, token, rules: { price: [{ sym: "qqq", type: "below", val: 400.5 }], calendar: { on: true, impact: "HighMedium", lead: 20 } } },
});
note(
  rules.status === 200 && rules.json?.subscription?.rules?.price?.[0]?.sym === "QQQ",
  "rules are saved and echoed back normalised",
  `status ${rules.status}`
);
note(
  !JSON.stringify(rules.json || {}).includes("987654321"),
  "no reply contains the chat id",
  "checked the rules reply"
);

// 10. A test send reaches the bot API and its refusal is reported honestly.
const test = await call("/api/alerts/test", { body: { id, token } });
note(
  [200, 502, 410].includes(test.status),
  "the test send answers honestly (stub token: 502 is expected)",
  `status ${test.status} · ${test.json?.sent || test.json?.error || "?"}`
);

// 11. /rules in the chat does not crash, even with the stub token.
const botRules = await call("/api/telegram/webhook", {
  body: update(987654321, "/rules"),
  origin: null,
  headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET },
});
note(botRules.status === 200, "the bot answers /rules", `status ${botRules.status}`);

// 12. Health reports booleans, never values.
const health = await call("/api/health", { method: "GET" });
const leaked = [health.text.includes("BEGIN"), health.text.includes("AAAA")]
  .some(Boolean);
note(
  health.status === 200 && health.json?.configured?.telegram === true && !leaked,
  "/api/health reports configuration as booleans, and no token",
  `telegram ${health.json?.configured?.telegram} · webhook secret ${health.json?.configured?.telegramWebhookSecret}`
);

// 13. Unsubscribe deletes the record, and the code stops resolving to it.
const off = await call("/api/alerts/unsubscribe", { body: { id, token } });
note(off.status === 200, "disconnecting deletes the record", `status ${off.status}`);

const afterOff = await call(`/api/alerts/link/status?code=${code}`, { method: "GET", origin: null });
note(
  afterOff.json?.linked === false,
  "the used code no longer resolves to a subscription",
  `linked ${afterOff.json?.linked} · removed ${afterOff.json?.removed === true}`
);

console.log(`\n${out.filter((r) => r.ok).length}/${out.length} checks passed`);
if (out.some((r) => !r.ok)) process.exit(1);
