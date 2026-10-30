/* telegram.js — the Telegram half of alerts: bot configuration, sending, and
 * the exact words that arrive in the chat.
 *
 * Why Telegram replaced browser push here, in one paragraph: web push needed a
 * VAPID key pair, a service worker per browser, an https origin, a Home-Screen
 * install on iPhone, and a push service in the middle that each platform runs
 * differently. Telegram needs one bot token, works on the phone, the desktop and
 * the web client, and delivers the same message whether the desk is open or not.
 * The price is that the message is no longer end-to-end encrypted to the device:
 * Telegram holds it, exactly as it holds every other chat. That trade is stated
 * in the desk and in the privacy page rather than left implied.
 *
 * Two things are deliberately kept apart in this file:
 *
 *   · `telegramBot()` is the single place that decides whether this deployment
 *     can send anything at all. A missing or malformed token or username makes
 *     the whole channel unavailable, and every caller then says so plainly
 *     instead of offering a button that cannot work.
 *   · The message builders are pure functions of an alert. Every value in them
 *     comes from the network - a quote, a headline, a calendar provider - so
 *     everything is escaped before it is placed in HTML. Telegram's HTML mode
 *     is a very small subset (b, i, code, a) and there is no way to inject a tag
 *     by sending a headline that contains "<".
 */

/** Telegram's own limit for one message. Anything longer is refused outright. */
export const TELEGRAM_MAX_TEXT = 4096;

/* BotFather tokens look like `123456789:AAH...` - a numeric bot id, a colon,
 * then 35 characters of base64url. The shape check is what turns a stray
 * environment variable into an honest "not configured" instead of a 404 from
 * api.telegram.org on every tick. */
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

/** Telegram usernames: 5-32 characters, letters, digits and underscores. */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** A chat id is a number, negative for groups and supergroups. */
const CHAT_ID_RE = /^-?\d{1,20}$/;

/**
 * The bot this deployment sends from, or null.
 *
 * `TELEGRAM_BOT_USERNAME` is a plain var in wrangler.toml because it is public -
 * it is the name every visitor types into Telegram. `TELEGRAM_BOT_TOKEN` is a
 * secret and never leaves the server. Both are required: the username is what
 * the desk builds the deep link from, so a token without it could send but could
 * not be connected to.
 */
export function telegramBot(env) {
  const token = String((env && env.TELEGRAM_BOT_TOKEN) || "").trim();
  const username = String((env && env.TELEGRAM_BOT_USERNAME) || "")
    .trim()
    .replace(/^@/, "");
  if (!TOKEN_RE.test(token)) return null;
  if (!USERNAME_RE.test(username)) return null;
  return { token, username };
}

/** True when this deployment can both send and be connected to. */
export function telegramReady(env) {
  return Boolean(telegramBot(env));
}

/** The public site, used only for the "open the desk" link in a message. */
export function siteUrl(env) {
  const raw = String((env && env.PUBLIC_SITE_URL) || "https://tickspy.com").trim();
  return raw.replace(/\/+$/, "") || "https://tickspy.com";
}

/**
 * The deep link a visitor presses to open the bot.
 *
 * `?start=<payload>` is Telegram's own mechanism: the payload comes back to the
 * bot as part of `/start`, so the visitor never types or copies the code. The
 * payload alphabet is A-Za-z0-9_- and the limit is 64 characters; a link code
 * here is 32 lowercase hex characters, which is inside both.
 */
export function deepLink(username, code) {
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}

/** Escape for Telegram's HTML parse mode. Untrusted text only ever goes here. */
export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A chat id we are willing to store and later send to. */
export function chatIdOk(id) {
  return CHAT_ID_RE.test(String(id == null ? "" : id));
}

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "--");

/** The desk link, appended to every alert. Kept short so it never dominates. */
function footer(env) {
  return `\n\n<a href="${siteUrl(env)}/desk/">Open the desk</a>`;
}

/**
 * One alert, as the chat sees it.
 *
 * `kind` matches what runAlertTick evaluates: price, news, calendar-soon,
 * calendar-released, test. The first line is bold and states the fact; the
 * second carries the numbers. No advice, no emoji per rule, and no "buy" or
 * "sell" anywhere - an alert is a report that a condition was observed.
 */
export function alertText(kind, detail, env) {
  const d = detail || {};
  switch (kind) {
    case "price": {
      // Two kinds of price rule read very differently, so they are written
      // differently: a level is "crossed 500", a percent rule is "up 2% today".
      if (d.type === "pct_up" || d.type === "pct_down") {
        const dir = d.type === "pct_up" ? "up" : "down";
        const pct = Number.isFinite(Number(d.pct)) ? Math.abs(Number(d.pct)).toFixed(1) : d.val;
        return (
          `🔔 <b>${escapeHtml(d.sym)} is ${dir} ${pct}% today</b>\n` +
          `Now ${fmt(d.price)} · previous close ${fmt(d.prevClose)} · your rule: ${dir} ${d.val}% from the previous close.` +
          footer(env)
        );
      }
      const dir = d.type === "above" ? "above" : "below";
      return (
        `🔔 <b>${escapeHtml(d.sym)} is ${dir} ${fmt(d.val)}</b>\n` +
        `Now ${fmt(d.price)} — price alert from TickSPY.` +
        footer(env)
      );
    }
    case "move": {
      const dir = d.dir === "up" ? "jumped" : "dropped";
      const pct = Number.isFinite(Number(d.pct)) ? Math.abs(Number(d.pct)).toFixed(1) : "--";
      return (
        `⚡ <b>${escapeHtml(d.sym)} ${dir} ${pct}% in ${Number(d.window)} min</b>\n` +
        `Now ${fmt(d.price)}, against ${fmt(d.from)} when the window opened. ` +
        `Your rule: ${d.dir === "up" ? "jumps" : "drops"} of ${d.threshold}% or more.` +
        footer(env)
      );
    }
    case "news": {
      const items = Array.isArray(d.items) ? d.items : [];
      const head = items.length === 1 ? "Market headline" : `${items.length} new headlines`;
      // One line per headline. Telegram wraps long lines itself, so no manual
      // splitting is needed and a mangled headline is never truncated mid-word.
      const lines = items
        .map((h) => h && h.title)
        .filter(Boolean)
        .map((t) => `• ${escapeHtml(String(t).slice(0, 300))}`)
        .join("\n");
      return `📰 <b>${head}</b>\n${lines}` + footer(env);
    }
    case "calendar-soon": {
      const impact = d.impact === "High" ? "HIGH IMPACT" : "Event";
      const when = Number(d.minutes) === 0 ? "now" : `in ${Number(d.minutes)} min`;
      const forecast = d.forecast ? ` · forecast ${escapeHtml(d.forecast)}` : "";
      return `⏰ <b>${escapeHtml(d.title)} — ${impact} ${when}</b>\nScheduled release${forecast}.` + footer(env);
    }
    case "calendar-released":
      return (
        `✅ <b>${escapeHtml(d.title)} released</b>\n` +
        `Actual ${escapeHtml(d.actual)} · forecast ${escapeHtml(d.forecast || "--")}.` +
        footer(env)
      );
    case "test":
      return (
        `✅ <b>Telegram alerts are working</b>\n` +
        `This is the test message from TickSPY. Price, news and calendar alerts will arrive here, ` +
        `at most once per five-minute check.` +
        footer(env)
      );
    default:
      return `🔔 <b>TickSPY</b>\n${escapeHtml(d.text || "You have an alert.")}` + footer(env);
  }
}

/* ------------------------------------------------------------- bot copy ---- */

/** Sent for a bare /start, or for any message we do not understand. */
export function welcomeText(env) {
  const site = siteUrl(env);
  return (
    `👋 <b>TickSPY alerts</b>\n\n` +
    `This bot sends the price, headline and economic-calendar alerts you set up on the desk. ` +
    `It never places a trade and it never asks for a password.\n\n` +
    `<b>To connect:</b>\n` +
    `1. Open <a href="${site}/desk/#alert">the desk</a> and go to the <b>Alerts</b> tab.\n` +
    `2. Press <b>Connect Telegram</b> there.\n` +
    `3. Press the link it shows. It brings you back to this chat with a one-time code, and ` +
    `pressing <b>Start</b> connects the two.\n\n` +
    `Commands: /rules shows what you are watching, /test sends a test message, /stop disconnects.`
  );
}

/** The reply to a successful /start <code>. */
export function connectedText(record, ruleLines, env) {
  const lines = ruleLines && ruleLines.length ? ruleLines : ["No rules yet."];
  return (
    `✅ <b>Connected</b>\n\n` +
    `Alerts will arrive in this chat. What is being watched right now:\n` +
    lines.map((l) => `• ${escapeHtml(l)}`).join("\n") +
    `\n\nAdd or change rules on the desk's <b>Alerts</b> tab and they apply to this chat immediately. ` +
    `Send /rules to check, /stop to disconnect.` +
    footer(env)
  );
}

export function stoppedText(env) {
  return (
    `🔕 <b>Disconnected</b>\n\n` +
    `Nothing will be sent to this chat any more, and the record holding your rules has been ` +
    `deleted from the server. To start again, press <b>Connect Telegram</b> on the desk.` +
    footer(env)
  );
}

export function notLinkedText(env) {
  return (
    `This chat is not connected yet.\n\n` +
    `Open <a href="${siteUrl(env)}/desk/#alert">the desk's Alerts tab</a>, press ` +
    `<b>Connect Telegram</b>, then press the link it shows.` +
    footer(env)
  );
}

export function expiredLinkText(env) {
  return (
    `That link has expired or was already used.\n\n` +
    `Link codes last 15 minutes and work once. Open the desk's ` +
    `<a href="${siteUrl(env)}/desk/#alert">Alerts tab</a> and press <b>Connect Telegram</b> again ` +
    `for a fresh one.`
  );
}

/** A short chat label for the desk: never the phone number, never the chat id. */
export function chatLabel(chat) {
  const c = chat && typeof chat === "object" ? chat : {};
  const name =
    c.title ||
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    (c.username ? `@${c.username}` : "");
  return String(name || "Telegram chat").slice(0, 60);
}

/* ------------------------------------------------------------- transport --- */

/**
 * One call to the Bot API.
 *
 * The failure that matters is the permanent one: 403 means the person blocked
 * the bot (or deleted the account), and 400 "chat not found" means the chat no
 * longer exists. Both are reported as `gone` so the caller can delete the
 * record; everything else is transient and is retried on the next tick. The
 * response body is never echoed into an alert or a log, because at this point
 * nothing in it belongs to us.
 */
export async function telegramCall({ env, method, payload, fetcher = fetch }) {
  const bot = telegramBot(env);
  if (!bot) return { ok: false, reason: "not_configured" };

  let res;
  try {
    res = await fetcher(`https://api.telegram.org/bot${bot.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  } catch (e) {
    return { ok: false, reason: "network", detail: String((e && e.message) || e) };
  }

  const body = await res.json().catch(() => null);
  if (res.ok && body && body.ok) return { ok: true, result: body.result };

  const description = String((body && body.description) || "");
  const gone =
    res.status === 403 ||
    /chat not found|user is deactivated|bot was blocked|bot can't initiate|peer_id_invalid/i.test(description);

  return {
    ok: false,
    status: res.status,
    reason: gone ? "gone" : res.status === 429 ? "rate_limited" : "send_failed",
    gone,
    description: description.slice(0, 200),
  };
}

/** Send one message to one chat. The only write this Worker makes outbound. */
export async function sendTelegram({ env, chatId, text, fetcher = fetch }) {
  if (!chatIdOk(chatId)) return { ok: false, reason: "bad_chat" };
  const body = String(text == null ? "" : text);
  if (!body.trim()) return { ok: false, reason: "empty" };

  return telegramCall({
    env,
    method: "sendMessage",
    payload: {
      chat_id: String(chatId),
      text: body.slice(0, TELEGRAM_MAX_TEXT),
      parse_mode: "HTML",
      // A link preview under every alert turns a two-line message into a card
      // for the desk, which is noise in a chat that may hold twenty of them.
      link_preview_options: { is_disabled: true },
    },
    fetcher,
  });
}
