#!/usr/bin/env node
/*
 * comments.mjs — moderate the community wall from a terminal.
 *
 * The token is a Worker secret. Set it once with:
 *   npx wrangler secret put COMMENTS_ADMIN_TOKEN
 * and keep a copy for yourself (a password manager, not this repository).
 *
 * Usage:
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs list
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs list --status hidden
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs list --status all --all
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs hide   <id>
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs show   <id>
 *   COMMENTS_ADMIN_TOKEN=... node scripts/comments.mjs delete <id>
 *
 * Options:
 *   --token <value>   instead of the environment variable
 *   --local           talk to `wrangler dev` on http://127.0.0.1:8787
 *   --api <origin>    any other deployment
 *
 * The output is deliberately plain: this is a tool for reading what strangers
 * wrote, and it should never be the thing that executes it.
 */

const args = process.argv.slice(2);
const command = args[0] || "list";

function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}
function has(name) {
  return args.includes(name);
}

const token = flag("--token") || process.env.COMMENTS_ADMIN_TOKEN || "";
const api = (
  flag("--api") ||
  process.env.TICKSPY_API ||
  (has("--local") ? "http://127.0.0.1:8787" : "https://tickspy-api.sdmtchebe.workers.dev")
).replace(/\/+$/, "");

if (!token) {
  console.error(
    "No moderation token.\n\n" +
      "  export COMMENTS_ADMIN_TOKEN=...   (the value set with `wrangler secret put COMMENTS_ADMIN_TOKEN`)\n" +
      "  or pass --token <value>.\n"
  );
  process.exit(2);
}

const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };

async function call(path, options = {}) {
  const res = await fetch(`${api}/api/comments/admin${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || `Request failed (${res.status}).`);
    error.code = data.error;
    error.status = res.status;
    throw error;
  }
  return data;
}

function stamp(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().replace("T", " ").slice(0, 16) : "?";
}

function print(list) {
  if (!list.length) {
    console.log("(nothing)");
    return;
  }
  for (const c of list) {
    const state = c.deleted ? "deleted" : c.status === "hidden" ? "held" : "visible";
    const filter = c.autoHidden ? " filtered" : "";
    console.log(`\n[${state}${filter}] ${stamp(c.createdAt)}  ${c.nickname}  id=${c.id}`);
    console.log(`  author ${c.authorHash || "?"}`);
    for (const line of String(c.body || "").split("\n")) console.log(`  ${line}`);
  }
}

async function main() {
  if (command === "list") {
    const status = flag("--status") || "visible";
    const all = has("--all");
    const limit = Math.min(100, Number(flag("--limit")) || 50);
    let before = null;
    let shown = 0;
    do {
      const query = `?status=${encodeURIComponent(status)}&limit=${limit}${before ? `&before=${before}` : ""}`;
      const data = await call(query);
      if (shown === 0) {
        console.log(
          `\nVisible ${data.counts.visible} · held ${data.counts.hidden} · deleted ${data.counts.deleted}`
        );
      }
      print(data.comments);
      shown += data.comments.length;
      before = all ? data.nextBefore : null;
      if (!data.comments.length) break;
    } while (before);
    console.log(`\n${shown} comment(s) shown.`);
    return;
  }

  if (command === "hide" || command === "show" || command === "delete") {
    const id = args[1];
    if (!id || id.startsWith("--")) {
      console.error(`Usage: node scripts/comments.mjs ${command} <id>`);
      process.exit(2);
    }
    const data = await call(`/${encodeURIComponent(id)}`, { method: "POST", body: { action: command } });
    console.log(`${data.action} ok for ${id}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Use list, hide, show or delete. See the header of this file.");
  process.exit(2);
}

main().catch((error) => {
  if (error.status === 401) {
    console.error("The server rejected that token (401). Nothing was changed.");
  } else if (error.code === "not_configured") {
    console.error("Moderation is off on this deployment: set COMMENTS_ADMIN_TOKEN with `wrangler secret put`.");
  } else {
    console.error(error.message);
  }
  process.exit(1);
});
