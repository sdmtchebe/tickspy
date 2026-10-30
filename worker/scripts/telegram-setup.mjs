/* Register the Telegram bot's webhook and commands.
 *
 *   cd worker
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *     node scripts/telegram-setup.mjs https://tickspy-api.sdmtchebe.workers.dev
 *
 * This is the step that turns a bot into a service: until Telegram knows where
 * to deliver a message, pressing Start in the chat goes nowhere. It is separate
 * from `wrangler deploy` because it is a change to the bot, not to the Worker,
 * and because it must be repeated if the Worker's URL ever changes.
 *
 * The token is read from the environment and never printed: it is the whole
 * authority of the bot, and a terminal scrollback or a CI log is not a safe
 * place for it. The same value goes into the Worker as a secret with
 *   npx wrangler secret put TELEGRAM_BOT_TOKEN
 * and the secret below with
 *   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
 * The two must match: Telegram echoes the secret in a header on every update,
 * and the Worker refuses updates that do not carry it.
 */
import { readFileSync } from "node:fs";

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const base = String(process.argv[2] || process.env.WORKER_URL || "").trim().replace(/\/+$/, "");

function usage(why) {
  if (why) console.error(`\n  ${why}\n`);
  console.error(
    [
      "Usage:",
      "  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \\",
      "    node scripts/telegram-setup.mjs https://<worker>.<account>.workers.dev",
      "",
      "The secret can be any long random string; generate one with:",
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      "",
      "Then store both in the Worker before or after running this:",
      "  npx wrangler secret put TELEGRAM_BOT_TOKEN",
      "  npx wrangler secret put TELEGRAM_WEBHOOK_SECRET",
      "",
    ].join("\n")
  );
  process.exit(1);
}

if (!token || !secret) usage("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are both required.");
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base)) {
  usage("Give the deployed Worker's https URL, for example https://tickspy-api.example.workers.dev");
}
if (secret.length < 20) usage("TELEGRAM_WEBHOOK_SECRET must be at least 20 characters; use a random one.");
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  // Telegram's own rule: the secret token may only contain A-Z, a-z, 0-9, _ and -.
  usage("TELEGRAM_WEBHOOK_SECRET may only contain letters, digits, underscores and dashes (Telegram's rule).");
}

const api = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.ok) {
    // Never echo the token, and treat the provider's description as text.
    const why = (body && body.description) || `HTTP ${res.status}`;
    throw new Error(`${method}: ${why}`);
  }
  return body.result;
};

/* The commands shown in Telegram's command menu, in the order they are useful. */
const COMMANDS = [
  { command: "start", description: "Connect this chat to TickSPY alerts" },
  { command: "rules", description: "Show the alerts being watched here" },
  { command: "test", description: "Send a test message" },
  { command: "stop", description: "Disconnect and delete the rules" },
  { command: "help", description: "How to connect, in three steps" },
];

console.log(`worker: ${base}\n`);

const me = await api("getMe");
console.log(`bot: @${me.username} (${me.first_name})`);

/* A mismatch here is the single most common mistake: the username typed into
 * wrangler.toml does not belong to the token being registered. The desk builds
 * its deep link from the username, so the two have to agree or every "Connect
 * Telegram" button opens a bot that knows nothing about this Worker. */
const declared = (readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").match(
  /^\s*TELEGRAM_BOT_USERNAME\s*=\s*"([^"]+)"/m
) || [])[1];
if (declared && declared.replace(/^@/, "").toLowerCase() !== me.username.toLowerCase()) {
  console.log(
    `\n  WARNING: wrangler.toml says TELEGRAM_BOT_USERNAME = "${declared}", but this token belongs to @${me.username}.` +
      `\n           Fix the var and redeploy, or the desk's deep links will open the wrong bot.\n`
  );
} else if (declared) {
  console.log(`wrangler.toml TELEGRAM_BOT_USERNAME matches.`);
}

await api("setMyCommands", { commands: COMMANDS });
console.log(`commands: ${COMMANDS.map((c) => "/" + c.command).join(" ")}`);

await api("setWebhook", {
  url: `${base}/api/telegram/webhook`,
  secret_token: secret,
  // Only messages matter to this bot; subscribing to everything else would just
  // make Telegram deliver updates the Worker immediately discards.
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
console.log(`webhook: ${base}/api/telegram/webhook`);

const info = await api("getWebhookInfo");
console.log(
  `state:   url ${info.url ? "set" : "MISSING"} · pending ${info.pending_update_count || 0}` +
    (info.last_error_message ? ` · last error: ${info.last_error_message}` : "")
);
console.log(
  "\nNext: open the desk's Alerts tab, press Connect Telegram, and press Start in the chat.\n"
);
