/* alertapi.js — the HTTP surface of Telegram alerts, and the bot's webhook.
 *
 * Split from alerts.js so the evaluation and delivery logic stays free of
 * request handling, and split from index.js so the Worker's own file does not
 * grow a second concern. The helpers it needs (the JSON responder, the origin
 * check) are passed in rather than imported, which keeps the CORS policy in one
 * place — index.js — where it can be read in full.
 *
 * There are two different kinds of caller here, and they are authenticated in
 * two different ways:
 *
 *   · THE DESK. A browser on an allowed origin. It creates a one-time link code,
 *     polls for the bot to consume it, and afterwards manages the subscription
 *     with an id and a secret token. These are POST-only and Origin-gated, since
 *     they are the only endpoints that accept input from a page.
 *   · TELEGRAM. The bot's webhook. It carries no Origin (Telegram is a server),
 *     so it is authenticated by the secret token Telegram echoes back in the
 *     `X-Telegram-Bot-Api-Secret-Token` header, which only Telegram and this
 *     Worker know. Anyone can POST to the URL; only Telegram can make it count.
 *
 * Safety properties, in one list:
 *
 *   · A link code is 16 random bytes, single-use, and expires in 15 minutes.
 *     Pressing Start is the only thing that attaches a chat to rules, and the
 *     person doing it holds the code the desk just generated.
 *   · The record id and a random token are both required to change or delete a
 *     subscription, and the token is compared in constant time.
 *   · Nothing here ever returns a chat id, a name or a phone number: the desk
 *     sees a short label and its own rules.
 *   · Every write is bounded: link codes per origin per minute, one test per
 *     subscription per minute, a cap on the store, and a cap on the body.
 */

import {
  LIMITS,
  LINK_TTL_MS,
  MAX_REARM_MINUTES,
  MAX_SUBSCRIPTIONS,
  MIN_REARM_MINUTES,
  cleanRules,
  deleteSubscription,
  getLink,
  getSubscription,
  linkCodeOk,
  listSubscriptions,
  newId,
  newLinkCode,
  newToken,
  putChatLink,
  putLink,
  putSubscription,
  rulesAreEmpty,
  rulesSummary,
  safeEqual,
  subscriptionIdForChat,
  subscriptionIdOk,
} from "./alerts.js";
import {
  chatIdOk,
  chatLabel,
  connectedText,
  deepLink,
  expiredLinkText,
  notLinkedText,
  sendTelegram,
  stoppedText,
  telegramBot,
  welcomeText,
  alertText,
} from "./telegram.js";

/* Per-isolate rate limit, the same shape as the bars budget: enough to stop a
 * script looping the endpoint, not a global guarantee. Cloudflare runs many
 * isolates, so this is a speed bump rather than a wall — the real protection is
 * that a chat only becomes a subscriber by pressing Start on a code the caller
 * generated. */
const WINDOW_MS = 60_000;
const HITS = new Map();

function rateLimited(key, limit = 10) {
  const now = Date.now();
  const list = (HITS.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= limit) {
    HITS.set(key, list);
    return true;
  }
  list.push(now);
  HITS.set(key, list);
  // Keep the map from growing without bound in a long-lived isolate.
  if (HITS.size > 5000) {
    for (const k of HITS.keys()) {
      if (HITS.get(k).every((t) => now - t >= WINDOW_MS)) HITS.delete(k);
      if (HITS.size <= 4000) break;
    }
  }
  return false;
}

/** Exported for tests. */
export function _clearRateLimits() {
  HITS.clear();
}

/** How often the alert cron runs. Stated in /api/alerts/config so the desk and
 *  the UI copy agree with wrangler.toml instead of drifting from it. */
export const TICK_MINUTES = 5;

/** The subscription body the desk renders. Never includes the chat id. */
function publicView(rec) {
  return {
    id: rec.id,
    channel: "telegram",
    chat: rec.chatLabel || "Telegram chat",
    rules: cleanRules(rec.rules),
    createdAt: rec.createdAt || null,
    lastSentAt: rec.lastSentAt || null,
  };
}

/** Everything a response needs, without repeating the two objects each time. */
function respond(json, request, env, body, status = 200) {
  return json(body, { status, request, env });
}

/* --------------------------------------------------------------- webhook --- */

/**
 * One Telegram update.
 *
 * Telegram retries anything that is not a 2xx, so this answers 200 once the
 * update has been understood — including for commands we do not implement, and
 * including when our own reply failed. A duplicate reply is worse than a
 * missing one: the person can press /help again, but a retry loop would send
 * the same message five times.
 */
async function handleWebhook({ request, env, json }) {
  const head = { request, env, method: "POST" };

  if (!telegramBot(env) || !env.CACHE) {
    return json(
      { ok: false, error: "not_configured", message: "Telegram alerts are not configured on this deployment." },
      { ...head, status: 503 }
    );
  }
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || "");
  const given = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  // The header is the whole authentication of this endpoint. Without a secret
  // configured there is nothing to compare against, so the endpoint refuses
  // rather than accepting anonymous writes.
  if (!expected || !safeEqual(expected, given)) {
    return json({ ok: false, error: "forbidden" }, { ...head, status: 401 });
  }

  const raw = await request.text().catch(() => "");
  if (raw.length > 32768) return json({ ok: false, error: "too_large" }, { ...head, status: 413 });
  let update = null;
  try {
    update = JSON.parse(raw);
  } catch {
    return json({ ok: true, ignored: "bad_json" }, head);
  }

  const message = update && (update.message || update.edited_message);
  const chat = message && message.chat;
  const chatId = chat && chat.id;
  if (!chatIdOk(chatId)) return json({ ok: true, ignored: "no_chat" }, head);

  const kv = env.CACHE;
  const text = String(message.text || "").trim();
  // "/rules@TickSPYBot" is how Telegram delivers a command in a group; the
  // mention is not part of the command.
  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = String(rawCmd || "").split("@")[0].toLowerCase();

  const reply = async (body) => {
    // Best effort: a reply that fails must not make Telegram resend the update.
    await sendTelegram({ env, chatId: String(chatId), text: body }).catch(() => {});
  };

  /* --- /start <code>: the only way a chat becomes a subscriber ------------- */
  if (cmd === "/start") {
    const payload = String(args[0] || "").trim().toLowerCase();
    if (!payload) {
      await reply(welcomeText(env));
      return json({ ok: true }, head);
    }
    if (!linkCodeOk(payload)) {
      await reply(expiredLinkText(env));
      return json({ ok: true }, head);
    }

    const link = await getLink(kv, payload);
    if (!link) {
      await reply(expiredLinkText(env));
      return json({ ok: true }, head);
    }
    // The same chat pressing the same link twice is not an error; a different
    // chat doing it is somebody else's expired code.
    if (link.id && link.chatId && String(link.chatId) !== String(chatId)) {
      await reply(expiredLinkText(env));
      return json({ ok: true }, head);
    }

    const existingId = (link.id) || (await subscriptionIdForChat(kv, String(chatId)));
    let rec = existingId ? await getSubscription(kv, existingId) : null;

    if (!rec) {
      const all = await listSubscriptions(kv);
      if (all.length >= MAX_SUBSCRIPTIONS) {
        await reply(welcomeText(env));
        return json({ ok: true, ignored: "full" }, head);
      }
      rec = {
        id: newId(),
        token: newToken(),
        chatId: String(chatId),
        chatLabel: chatLabel(chat),
        rules: cleanRules(link.rules),
        createdAt: new Date().toISOString(),
        fired: {},
      };
    } else {
      // Re-linking replaces the label and keeps the rules the person already
      // had, unless the link carried a different set.
      const incoming = cleanRules(link.rules);
      rec = {
        ...rec,
        chatId: String(chatId),
        chatLabel: chatLabel(chat),
        rules: rulesAreEmpty(incoming) ? rec.rules : incoming,
      };
    }

    await putSubscription(kv, rec);
    await putChatLink(kv, rec);
    // Hand the credentials to the desk that generated the code, for the rest of
    // the code's lifetime, so a poll that lands a moment later still works.
    await putLink(kv, payload, {
      at: Number(link.at) || Date.now(),
      id: rec.id,
      token: rec.token,
      chatId: String(chatId),
    });

    await reply(connectedText(rec, rulesSummary(cleanRules(rec.rules)), env));
    return json({ ok: true }, head);
  }

  /* --- /stop: forget everything about this chat --------------------------- */
  if (cmd === "/stop" || cmd === "/unlink" || cmd === "/disconnect") {
    const id = await subscriptionIdForChat(kv, String(chatId));
    if (id) await deleteSubscription(kv, id);
    await reply(stoppedText(env));
    return json({ ok: true }, head);
  }

  /* --- /rules: what is being watched -------------------------------------- */
  if (cmd === "/rules" || cmd === "/alerts") {
    const id = await subscriptionIdForChat(kv, String(chatId));
    const rec = id ? await getSubscription(kv, id) : null;
    if (!rec) {
      await reply(notLinkedText(env));
      return json({ ok: true }, head);
    }
    const lines = rulesSummary(cleanRules(rec.rules));
    await reply(
      `🔎 <b>Your TickSPY rules</b>\n\n` +
        (lines.length ? lines.map((l) => `• ${l}`).join("\n") : "No rules yet.") +
        `\n\nChange them on the desk's Alerts tab.`
    );
    return json({ ok: true }, head);
  }

  /* --- /test -------------------------------------------------------------- */
  if (cmd === "/test") {
    const id = await subscriptionIdForChat(kv, String(chatId));
    const rec = id ? await getSubscription(kv, id) : null;
    if (!rec) {
      await reply(notLinkedText(env));
      return json({ ok: true }, head);
    }
    if (rateLimited(`bottest:${chatId}`, 3)) {
      await reply("A test was sent a moment ago. Give it a few seconds.");
      return json({ ok: true, ignored: "rate_limited" }, head);
    }
    await reply(alertText("test", {}, env));
    return json({ ok: true }, head);
  }

  /* --- anything else ------------------------------------------------------ */
  if (cmd === "/help") {
    await reply(welcomeText(env));
    return json({ ok: true }, head);
  }

  await reply(welcomeText(env));
  return json({ ok: true, ignored: "unknown_command" }, head);
}

/* ----------------------------------------------------------------- routes -- */

/**
 * Handle one alerts request.
 *
 * @returns {Promise<Response|null>} null when the path is not ours, so index.js
 *   can fall through to its own routes.
 */
export async function alertRoutes({ request, env, ctx, url, json, originAllowed }) {
  const isAlerts = url.pathname.startsWith("/api/alerts") || url.pathname.startsWith("/api/telegram");
  if (!isAlerts) return null;

  const kv = env.CACHE || null;
  const bot = telegramBot(env);
  const ready = Boolean(bot && kv);

  /* ----------------------------------------------------------- webhook --- */
  if (url.pathname === "/api/telegram/webhook") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, request, env });
    }
    return handleWebhook({ request, env, json });
  }

  /* ------------------------------------------------------------- config --- *
   * What this deployment can actually do. The desk renders its Alerts-tab
   * controls from this, so it never offers a channel the server cannot deliver
   * — which is the difference between an honest "not switched on here" and a
   * button that silently does nothing. */
  if (url.pathname === "/api/alerts/config" && request.method === "GET") {
    return json(
      {
        telegram: ready,
        botUsername: bot ? bot.username : null,
        // Stated here so the desk's tutorial can print the exact address rather
        // than hard-coding a bot name that may be rotated.
        deepLinkBase: bot ? `https://t.me/${bot.username}` : null,
        maxSubscriptions: MAX_SUBSCRIPTIONS,
        maxPriceRules: LIMITS.price,
        tickMinutes: TICK_MINUTES,
        linkTtlMinutes: Math.round(LINK_TTL_MS / 60000),
        // The bounds the rule editor is built around, so the page cannot offer a
        // control the server would silently clamp.
        limits: {
          priceRules: LIMITS.price,
          moveSymbols: LIMITS.moveSymbols,
          newsSymbols: LIMITS.newsSymbols,
          words: LIMITS.words,
          wordLength: LIMITS.wordLength,
          moveWindow: LIMITS.moveWindow,
          moveThreshold: LIMITS.moveThreshold,
          pricePercent: LIMITS.pricePercent,
          lead: LIMITS.lead,
          rearm: [MIN_REARM_MINUTES, MAX_REARM_MINUTES],
        },
        // Why it is off, when it is off: one sentence, in the desk's own words.
        note: ready
          ? null
          : !kv
            ? "Telegram alerts need the KV namespace bound to this Worker."
            : "This deployment has no Telegram bot token, so nothing can be sent from it yet.",
      },
      { request, env }
    );
  }

  /* ------------------------------------------------ link status (GET) ---- *
   * Polled by the desk while the tutorial is on screen. The code is the
   * credential: it is generated in the browser, lives 15 minutes, and is only
   * known to the page that made it (and the bot that consumed it). A GET here
   * is safe for the same reason the code is unguessable, and it is deliberately
   * not Origin-gated so a preflight never delays a poll. */
  if (url.pathname === "/api/alerts/link/status") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405, request, env });
    }
    if (!kv) {
      return json({ linked: false, error: "not_configured", message: "Telegram alerts are not configured here." }, { status: 503, request, env });
    }
    const code = String(url.searchParams.get("code") || "").toLowerCase();
    if (!linkCodeOk(code)) {
      return json({ linked: false, error: "bad_code", message: "That link code is not valid." }, { status: 400, request, env });
    }
    const link = await getLink(kv, code);
    if (!link) return json({ linked: false, expired: true }, { request, env });
    if (!link.id) {
      return json({ linked: false, expiresAt: new Date((Number(link.at) || Date.now()) + LINK_TTL_MS).toISOString() }, { request, env });
    }
    const rec = await getSubscription(kv, link.id);
    if (!rec) return json({ linked: false, expired: true, removed: true }, { request, env });
    return json(
      { linked: true, id: rec.id, token: link.token, subscription: publicView(rec) },
      { request, env }
    );
  }

  // Everything past here accepts input from a page, so it is POST-only and
  // Origin-gated.
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, request, env });
  }
  const origin = request.headers.get("Origin") || "";
  if (!origin || !originAllowed(origin)) {
    return json(
      { error: "forbidden_origin", message: "This request did not come from an allowed site." },
      { status: 403, request, env }
    );
  }
  if (!ready) {
    return json(
      {
        error: "not_configured",
        message:
          "Telegram alerts are not switched on for this deployment yet. See worker/README.md for the two secrets they need.",
      },
      { status: 503, request, env }
    );
  }

  // A small body cap: a rules object is a few hundred bytes, so anything larger
  // is not a client we are serving.
  const raw = await request.text().catch(() => "");
  if (raw.length > 8192) {
    return respond(json, request, env, { error: "too_large", message: "That request is too large." }, 413);
  }
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return respond(json, request, env, { error: "bad_json", message: "That request was not valid JSON." }, 400);
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  /* -------------------------------------------------------- link/start --- *
   * Makes the one-time code and the deep link the tutorial shows. Nothing is
   * stored about the caller: the code is the whole state, and it expires. */
  if (url.pathname === "/api/alerts/link/start") {
    if (rateLimited(`link:${origin}`, 10)) {
      return respond(json, request, env, { error: "rate_limited", message: "Too many codes from here right now. Try again in a minute." }, 429);
    }
    const code = newLinkCode();
    const at = Date.now();
    await putLink(kv, code, { at, rules: cleanRules(body.rules) });
    return respond(json, request, env, {
      ok: true,
      code,
      botUsername: bot.username,
      deepLink: deepLink(bot.username, code),
      expiresAt: new Date(at + LINK_TTL_MS).toISOString(),
      ttlMinutes: Math.round(LINK_TTL_MS / 60000),
    });
  }

  /* ----------------------------------------- authenticated management ---- */
  const needAuth = ["/api/alerts/rules", "/api/alerts/test", "/api/alerts/unsubscribe"];
  let rec = null;
  if (needAuth.includes(url.pathname)) {
    const id = String(body.id || "");
    const token = String(body.token || "");
    if (!subscriptionIdOk(id) || !token) {
      return respond(json, request, env, { error: "bad_id", message: "That subscription id is not valid." }, 400);
    }
    rec = await getSubscription(kv, id);
    if (!rec || !safeEqual(rec.token || "", token)) {
      return respond(json, request, env, { error: "not_found", message: "That subscription no longer exists on this server." }, 404);
    }
  }

  if (url.pathname === "/api/alerts/rules") {
    const rules = cleanRules(body.rules);
    const updated = { ...rec, rules };
    await putSubscription(kv, updated);
    return json({ ok: true, subscription: publicView(updated) }, { request, env });
  }

  if (url.pathname === "/api/alerts/test") {
    if (rateLimited(`test:${rec.id}`, 3)) {
      return respond(json, request, env, { error: "rate_limited", message: "A test was sent a moment ago. Give it a few seconds." }, 429);
    }
    const r = await sendTelegram({
      env,
      chatId: rec.chatId,
      text: alertText("test", {}, env),
    });
    if (r.ok) return json({ ok: true, sent: "telegram" }, { request, env });
    if (r.gone) {
      await deleteSubscription(kv, rec.id);
      return respond(
        json,
        request,
        env,
        {
          error: "gone",
          message:
            "Telegram says this chat no longer accepts messages from the bot — the bot was blocked or the chat was deleted. The record was removed. Press Connect Telegram to link a chat again.",
        },
        410
      );
    }
    return respond(
      json,
      request,
      env,
      {
        error: r.reason === "not_configured" ? "not_configured" : "send_failed",
        message:
          r.reason === "not_configured"
            ? "This deployment has no bot token, so nothing can be sent."
            : "Telegram could not deliver that message just now. Try again in a moment.",
      },
      r.reason === "not_configured" ? 503 : 502
    );
  }

  if (url.pathname === "/api/alerts/unsubscribe") {
    await deleteSubscription(kv, rec.id);
    // Best effort: tell the chat why the messages stop. A blocked bot cannot be
    // told anything, and that is fine.
    await sendTelegram({ env, chatId: rec.chatId, text: stoppedText(env) }).catch(() => {});
    return json({ ok: true }, { request, env });
  }

  return respond(json, request, env, { error: "Not found" }, 404);
}

/** Exported for the tests: the bot-facing command list we document in /help. */
export const BOT_COMMANDS = ["/start <code>", "/rules", "/test", "/stop"];
