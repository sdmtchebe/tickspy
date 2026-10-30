/* comments.js — the anonymous community wall on the landing page.
 *
 * The site is static, so this is the one part of it that stores what a visitor
 * wrote. That makes it the part worth thinking about, and the design follows
 * from three promises the page makes:
 *
 *   1. ANONYMOUS. There is no name, email or account. The browser generates a
 *      32-byte random token once and keeps it in localStorage. The server never
 *      returns it, never logs it, and stores only a SHA-256 digest of it. The
 *      nickname ("Quiet Otter #4821") is derived from that digest, so the same
 *      browser keeps the same name without the server knowing who it is.
 *
 *   2. YOURS TO DELETE. A delete statement is scoped by
 *      `id = ? AND author_hash = ?`. Knowing a comment's id is not enough: the
 *      caller has to hold the token that produced the stored digest. The text
 *      is wiped in the same statement, so "deleted" means gone, not hidden.
 *
 *   3. NOT A SCRIPTING HOLE. Nothing here builds HTML. A comment is stored as
 *      plain text and rendered by React as text, so `<script>` is three
 *      characters and the word "script", not an element. The worker also
 *      refuses non-JSON bodies, caps the size before parsing, and rejects
 *      anything that is not shaped like a comment. There is no SQL string
 *      concatenation: every value is bound.
 *
 * Abuse is bounded in layers, because no single one survives a motivated
 * script:
 *   · per-identity: a 20-second gap, 8 an hour, 40 a day (D1, so it holds
 *     across isolates and regions);
 *   · per-IP: in-memory counters for posts and reads (a speed bump, not a
 *     wall — Cloudflare runs many isolates);
 *   · per-visitor bot gate: Cloudflare Turnstile, once the deployment sets a
 *     site key and secret. A script cannot mint a token, and a token works
 *     once. Unconfigured, this layer is absent and the rest still apply;
 *   · per-text: a plain-language filter that holds links, shouting, obvious
 *     slurs and injection-shaped markup for a human instead of publishing it;
 *   · a human: /moderation.html and scripts/comments.mjs, authenticated by a
 *     Worker secret that is never part of the build.
 *
 * Everything in this file is deliberately boring and explicit. A clever
 * moderation rule is a rule nobody can predict.
 */

/* ------------------------------------------------------------- constants --- */

/** 32 random bytes, base64url, no padding. The client generates exactly this. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ID_RE = /^[A-Za-z0-9_-]{10,24}$/;

export const MAX_BODY = 1000;
const MIN_BODY = 3;
export const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;

/* Per identity, enforced by D1 so every isolate agrees. A deleted comment still
 * counts as posted: otherwise delete-and-repost is an infinite loop. */
const MIN_GAP_MS = 20_000;
const POSTS_PER_HOUR = 8;
const POSTS_PER_DAY = 40;

/* Per IP, in memory only, and never written anywhere. */
const POSTS_PER_IP_MINUTE = 6;
const POSTS_PER_IP_HOUR = 30;
const READS_PER_IP_MINUTE = 120;
const ADMIN_FAILS_PER_MINUTE = 6;

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

/* ---------------------------------------------------------------- helpers -- */

const encoder = new TextEncoder();

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(bytes = 9) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison of two secrets, tolerant of different lengths. */
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function identityOk(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer ([^\s]{16,200})$/.exec(header);
  return match ? match[1] : null;
}

/** The only link between a comment and its author. Irreversible in practice. */
export function authorHash(token) {
  return sha256Hex(`tickspy-comment-author-v1:${token}`);
}

const ADJECTIVES = [
  "Amber", "Brisk", "Calm", "Clever", "Copper", "Crisp", "Dusk", "Eager",
  "Faint", "Gentle", "Golden", "Hushed", "Iron", "Keen", "Lunar", "Mellow",
  "Nimble", "Olive", "Pale", "Patient", "Quick", "Rust", "Silver", "Slate",
  "Steady", "Swift", "Tidal", "Velvet", "Wandering", "Winter", "Witty", "Zinc",
];
const ANIMALS = [
  "Otter", "Falcon", "Heron", "Badger", "Bison", "Condor", "Cricket", "Dolphin",
  "Egret", "Ferret", "Finch", "Fox", "Gecko", "Hare", "Hedgehog", "Ibex",
  "Jackal", "Kestrel", "Lark", "Lemur", "Lynx", "Magpie", "Moth", "Narwhal",
  "Osprey", "Panda", "Quail", "Raven", "Seal", "Sparrow", "Tern", "Wren",
];

/** A stable pseudonym derived from the author digest. */
export function nicknameFor(hash) {
  const a = parseInt(hash.slice(0, 4), 16);
  const b = parseInt(hash.slice(4, 8), 16);
  const n = (parseInt(hash.slice(8, 12), 16) % 9000) + 1000;
  return `${ADJECTIVES[a % ADJECTIVES.length]} ${ANIMALS[b % ANIMALS.length]} #${n}`;
}

export function avatarFor(hash) {
  return parseInt(hash.slice(12, 14), 16) % 6;
}

/**
 * Normalise a submitted comment. Returns `{ value }` or `{ error }`, never a
 * half-cleaned string that the caller might store by accident.
 *
 * Newlines are kept (they are formatting, not injection). Every other control
 * character is dropped, as are the zero-width and bidirectional overrides that
 * exist mainly to make text look like something it is not.
 */
export function cleanBody(input) {
  if (typeof input !== "string") return { error: "bad_body" };
  const value = input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B\u200E\u200F\u061C\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (value.length < MIN_BODY) return { error: "too_short" };
  if (value.length > MAX_BODY) return { error: "too_long" };
  return { value };
}

/* A hold list, not a ban list. A match keeps the comment out of the public feed
 * until a person looks at it; a false positive costs a click, not a voice.
 * Deliberately short — no attempt at cleverness — and matched on whole words,
 * because a substring match held "the spices" and "not conspicuous" as slurs. */
const HELD_TERMS = [
  "nigger", "faggot", "kike", "spic", "chink", "retard", "tranny",
  "heil hitler", "white power", "gas the",
];

const HELD_RE = new RegExp(
  `\\b(?:${HELD_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i"
);

/**
 * Why a comment should be held for review, or null if it can go straight up.
 * The reason is kept for the hold decision and never shown to the poster:
 * telling a spammer which word tripped the filter is a tutorial.
 */
export function spamReason(body) {
  const lower = body.toLowerCase();
  if (HELD_RE.test(lower)) return "abuse";

  const links = (body.match(/https?:\/\/|www\./gi) || []).length;
  if (links > 2) return "links";

  // "t.me/x", "wa.me/..." and bare "join my telegram" are the usual spam shape.
  if (/(?:t\.me|wa\.me|discord\.gg)\//i.test(body)) return "link";
  if (/(telegram|whatsapp|discord)[^.\n]{0,40}(group|signal|join|dm|channel)/i.test(body)) return "solicitation";

  if (/(.)\1{19,}/.test(body)) return "repetition";
  if (/<\s*(script|iframe|object|embed)\b|javascript:|on(?:error|load)\s*=/i.test(body)) return "markup";

  const letters = body.replace(/[^A-Za-z]/g, "");
  const capitals = (body.match(/[A-Z]/g) || []).length;
  if (letters.length >= 50 && capitals / letters.length > 0.75) return "shouting";

  return null;
}

/* ---------------------------------------------------------------- limits --- */

/* Each bucket remembers the window it was made with. Pruning used to test every
 * key against whatever window the current caller passed, so one 60-second
 * request could delete a fresh hour-long bucket and quietly reset the hourly
 * post limit. The window now travels with the hits. */
const BUCKETS = new Map();

function pruneBuckets(now) {
  for (const [key, bucket] of BUCKETS) {
    if (!bucket.hits.length || bucket.hits.every((t) => now - t >= bucket.windowMs)) BUCKETS.delete(key);
    if (BUCKETS.size <= 4000) break;
  }
}

/** Count one hit against a key; true when the caller is over its budget. */
function limited(key, limit, windowMs, now = Date.now()) {
  const bucket = BUCKETS.get(key);
  const hits = bucket ? bucket.hits.filter((t) => now - t < windowMs) : [];
  if (hits.length >= limit) {
    BUCKETS.set(key, { hits, windowMs });
    return true;
  }
  hits.push(now);
  BUCKETS.set(key, { hits, windowMs });
  // A long-lived isolate must not accumulate an entry per visitor forever.
  if (BUCKETS.size > 5000) pruneBuckets(now);
  return false;
}

export function _clearRateLimits() {
  BUCKETS.clear();
}

function ipOf(request) {
  // Cloudflare sets this; it is used for a counter in memory and is never
  // stored, hashed into the database, or returned. Without it every caller
  // shares one bucket, which is still preferable to no limit at all.
  return (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 64);
}

/* -------------------------------------------------------------- turnstile -- */
/* The bot gate. Cloudflare Turnstile issues a single-use token to a real
 * browser and never fingerprints the visitor; a script cannot mint one, which
 * is exactly what the in-memory counters cannot promise.
 *
 * It is optional, and enabled only when BOTH halves are present: the public
 * site key (a var, so the page can render the widget) and the secret (a Worker
 * secret, so only the server can check it). The public key is advertised in the
 * feed, so enabling the gate needs a Worker deploy and no frontend rebuild. */

const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(env) {
  return Boolean(env && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

/**
 * true = verified, false = a real "not a human" answer, null = the verifier
 * itself did not answer. Callers treat null as "try again", never as a pass,
 * because a gate that opens when it cannot reach the lock is not a gate.
 */
async function turnstileCheck(env, token, ip) {
  if (typeof token !== "string" || !token.trim() || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", String(env.TURNSTILE_SECRET_KEY));
  form.append("response", token);
  if (ip && ip !== "unknown") form.append("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_URL, { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Boolean(data && data.success === true);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- cursor -- */
/* A page cursor is "<created_at>_<id>". A bare timestamp is still accepted, so
 * a link made before the id was added keeps working. */

function parseCursor(raw) {
  const text = String(raw || "");
  const match = /^(\d{1,16})_([A-Za-z0-9_-]{10,24})$/.exec(text);
  if (match) return { at: Number(match[1]), id: match[2] };
  const legacy = Number(text);
  return Number.isFinite(legacy) && legacy > 0 ? { at: Math.floor(legacy), id: null } : null;
}

function cursorWhere(cursor) {
  return cursor.id ? "(created_at < ? OR (created_at = ? AND id < ?))" : "created_at < ?";
}

function cursorArgs(cursor) {
  return cursor.id ? [cursor.at, cursor.at, cursor.id] : [cursor.at];
}

function encodeCursor(row) {
  return `${Number(row.created_at)}_${row.id}`;
}

/* ------------------------------------------------------------------- db ---- */

async function countRecent(db, hash, since) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM comments WHERE author_hash = ? AND created_at > ?")
    .bind(hash, since)
    .first();
  return row ? Number(row.n) || 0 : 0;
}

async function lastPostedAt(db, hash) {
  const row = await db
    .prepare("SELECT created_at FROM comments WHERE author_hash = ? ORDER BY created_at DESC LIMIT 1")
    .bind(hash)
    .first();
  return row ? Number(row.created_at) || 0 : 0;
}

function publicView(row, viewerHash) {
  return {
    id: row.id,
    nickname: row.nickname,
    body: row.body,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    at: Number(row.created_at),
    avatar: Number(row.avatar) || 0,
    mine: Boolean(viewerHash) && row.author_hash === viewerHash,
  };
}

function adminView(row) {
  return {
    ...publicView(row, null),
    status: row.status,
    autoHidden: Boolean(row.auto_hidden),
    deleted: Boolean(row.deleted),
    deletedAt: row.deleted_at ? new Date(Number(row.deleted_at)).toISOString() : null,
    authorHash: String(row.author_hash || "").slice(0, 12),
  };
}

/* --------------------------------------------------------------- handlers -- */

async function listComments({ request, env, url, json }) {
  const db = env.COMMENTS_DB;
  const token = bearerToken(request);
  const viewerHash = identityOk(token) ? await authorHash(token) : null;

  const cursor = parseCursor(url.searchParams.get("before"));
  const requested = Number(url.searchParams.get("limit")) || PAGE_DEFAULT;
  const limit = Math.min(PAGE_MAX, Math.max(1, requested));

  let sql =
    "SELECT id, nickname, body, created_at, avatar, author_hash FROM comments " +
    "WHERE deleted = 0 AND status = 'visible'";
  // The cursor carries the id as well as the timestamp. With the timestamp
  // alone, two comments written in the same millisecond lost one of them
  // forever: the next page asked for `created_at < last`, which excludes its
  // twin. Ordering by id too makes the page boundary total.
  if (cursor) sql += ` AND ${cursorWhere(cursor)}`;
  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  // D1 binds positionally in the order the placeholders appear, and the cursor
  // sits before LIMIT in the text, so the argument list is built to match.
  const args = cursor ? [...cursorArgs(cursor), limit + 1] : [limit + 1];

  const result = await db.prepare(sql).bind(...args).all();
  const rows = (result && result.results) || [];
  const page = rows.slice(0, limit);

  let total;
  if (!cursor) {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM comments WHERE deleted = 0 AND status = 'visible'")
      .first();
    total = row ? Number(row.n) || 0 : 0;
  }

  const you = viewerHash
    ? { nickname: nicknameFor(viewerHash), avatar: avatarFor(viewerHash) }
    : null;

  return json(
    {
      comments: page.map((row) => publicView(row, viewerHash)),
      you,
      nextBefore: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
      ...(total === undefined ? {} : { total }),
      turnstile: turnstileEnabled(env) ? { siteKey: String(env.TURNSTILE_SITE_KEY) } : null,
      limits: { body: MAX_BODY, page: limit },
    },
    { request, env }
  );
}

async function createComment({ request, env, json, originAllowed }) {
  const db = env.COMMENTS_DB;

  // A write from a page must come from a page we know. The CORS grant alone is
  // not enough: a cross-site form POST with a text/plain body never triggers a
  // preflight, so this is the check that actually stops it.
  const origin = request.headers.get("Origin") || "";
  if (!origin || !originAllowed(origin)) {
    return json(
      { error: "forbidden_origin", message: "This request did not come from the TickSPY site." },
      { status: 403, request, env }
    );
  }

  const ip = ipOf(request);
  if (limited(`post-min:${ip}`, POSTS_PER_IP_MINUTE, 60_000) ||
      limited(`post-hour:${ip}`, POSTS_PER_IP_HOUR, 3_600_000)) {
    return json(
      { error: "rate_limited", message: "That is a lot of comments in a short time. Try again in a few minutes." },
      { status: 429, request, env }
    );
  }

  // Read with a hard cap before parsing: a body larger than this is not a
  // comment, whatever it claims to be.
  const raw = await request.text().catch(() => "");
  if (raw.length > 4096) {
    return json({ error: "too_large", message: "That comment is too large." }, { status: 413, request, env });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json", message: "That request was not valid JSON." }, { status: 400, request, env });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "bad_json", message: "That request was not valid JSON." }, { status: 400, request, env });
  }

  const token = bearerToken(request);
  if (!identityOk(token)) {
    return json(
      { error: "no_identity", message: "Your browser has no community identity yet. Reload the page and try again." },
      { status: 401, request, env }
    );
  }

  /* The bot gate, before any database work. A missing token and a bad token get
   * the same shape of answer, so a script learns nothing about the check. */
  if (turnstileEnabled(env)) {
    const verdict = await turnstileCheck(env, payload.turnstileToken, ip);
    if (verdict === null) {
      return json(
        { error: "turnstile_unavailable", message: "The human check could not be reached. Try again in a moment." },
        { status: 503, request, env }
      );
    }
    if (!verdict) {
      return json(
        { error: "turnstile_failed", message: "That check did not pass. Reload the page and try again." },
        { status: 403, request, env }
      );
    }
  }

  const cleaned = cleanBody(payload.body);
  if (cleaned.error === "too_long") {
    return json(
      { error: "too_long", message: `Comments are limited to ${MAX_BODY} characters.` },
      { status: 413, request, env }
    );
  }
  if (cleaned.error) {
    return json(
      { error: "too_short", message: "Write at least a few characters." },
      { status: 400, request, env }
    );
  }
  const body = cleaned.value;
  const hash = await authorHash(token);
  const now = Date.now();

  // D1-backed limits hold across isolates, unlike the in-memory counters above.
  const last = await lastPostedAt(db, hash);
  if (last && now - last < MIN_GAP_MS) {
    const wait = Math.ceil((MIN_GAP_MS - (now - last)) / 1000);
    return json(
      { error: "rate_limited", message: `Give it ${wait} more second${wait === 1 ? "" : "s"} before posting again.` },
      { status: 429, request, env }
    );
  }
  if ((await countRecent(db, hash, now - 3_600_000)) >= POSTS_PER_HOUR) {
    return json(
      { error: "rate_limited", message: "You have posted a lot this hour. Take a break and come back." },
      { status: 429, request, env }
    );
  }
  if ((await countRecent(db, hash, now - 86_400_000)) >= POSTS_PER_DAY) {
    return json(
      { error: "rate_limited", message: "You have reached the daily comment limit. It resets tomorrow." },
      { status: 429, request, env }
    );
  }

  const bodyHash = await sha256Hex(`tickspy-comment-body-v1:${body.toLowerCase()}`);
  const duplicate = await db
    .prepare("SELECT 1 AS n FROM comments WHERE body_hash = ? AND created_at > ? LIMIT 1")
    .bind(bodyHash, now - DUPLICATE_WINDOW_MS)
    .first();
  if (duplicate) {
    return json(
      { error: "duplicate", message: "That exact comment was posted a moment ago." },
      { status: 409, request, env }
    );
  }

  const reason = spamReason(body);
  const held = Boolean(reason);
  const id = randomId(9);

  try {
    await db
      .prepare(
        "INSERT INTO comments (id, created_at, body, body_hash, nickname, author_hash, avatar, status, auto_hidden, deleted) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
      )
      .bind(
        id,
        now,
        body,
        bodyHash,
        nicknameFor(hash),
        hash,
        avatarFor(hash),
        held ? "hidden" : "visible",
        held ? 1 : 0
      )
      .run();
  } catch {
    // The only realistic conflict is the primary key, which is random and 72
    // bits wide. Answer without echoing the database error.
    return json(
      { error: "not_stored", message: "The comment could not be saved. Try again in a moment." },
      { status: 500, request, env }
    );
  }

  return json(
    {
      ok: true,
      held,
      message: held
        ? "Thanks — that comment is held for a quick review and will appear once it is approved."
        : null,
      comment: {
        id,
        nickname: nicknameFor(hash),
        body,
        createdAt: new Date(now).toISOString(),
        at: now,
        avatar: avatarFor(hash),
        mine: true,
      },
    },
    { status: 201, request, env }
  );
}

async function deleteComment({ request, env, json, id }) {
  const db = env.COMMENTS_DB;
  const token = bearerToken(request);
  if (!identityOk(token)) {
    return json(
      { error: "no_identity", message: "Your browser has no community identity, so there is nothing to delete." },
      { status: 401, request, env }
    );
  }
  const hash = await authorHash(token);

  // Scoped by author_hash in the statement itself. An id alone is public
  // information; it must never be sufficient.
  const result = await db
    .prepare("UPDATE comments SET deleted = 1, status = 'hidden', body = '', deleted_at = ? WHERE id = ? AND author_hash = ? AND deleted = 0")
    .bind(Date.now(), id, hash)
    .run();
  const changed = Number((result && result.meta && result.meta.changes) || 0);
  if (!changed) {
    // The same answer whether the comment is missing, deleted, or somebody
    // else's: the caller learns nothing about other people's rows.
    return json({ error: "not_found", message: "That comment no longer exists." }, { status: 404, request, env });
  }
  return json({ ok: true }, { request, env });
}

/* ---------------------------------------------------------------- admin ---- */

async function adminAuthorised(request, env) {
  const expected = String(env.COMMENTS_ADMIN_TOKEN || "");
  const given = bearerToken(request);
  if (!expected || !given) return false;

  // Brute force a long random token is already hopeless; this keeps a noisy
  // script from turning the endpoint into a free oracle. Only failures count,
  // so a legitimate moderator is never locked out by their own typing.
  const key = `admin-fail:${ipOf(request)}`;
  const now = Date.now();
  const bucket = BUCKETS.get(key);
  const recent = bucket ? bucket.hits.filter((t) => now - t < 60_000) : [];
  if (recent.length >= ADMIN_FAILS_PER_MINUTE) return false;
  if (await safeEqual(given, expected)) return true;
  recent.push(now);
  BUCKETS.set(key, { hits: recent, windowMs: 60_000 });
  return false;
}

async function adminList({ request, env, url, json }) {
  if (!env.COMMENTS_ADMIN_TOKEN) {
    return json(
      {
        error: "not_configured",
        message: "Moderation is not switched on: set the COMMENTS_ADMIN_TOKEN secret on the Worker.",
      },
      { status: 503, request, env }
    );
  }
  if (!(await adminAuthorised(request, env))) {
    return json({ error: "forbidden", message: "That moderation token was not accepted." }, { status: 401, request, env });
  }

  const db = env.COMMENTS_DB;
  const status = String(url.searchParams.get("status") || "visible");
  const allowed = ["visible", "hidden", "deleted", "all"];
  if (!allowed.includes(status)) {
    return json({ error: "bad_status", message: "status must be visible, hidden, deleted or all." }, { status: 400, request, env });
  }
  const cursor = parseCursor(url.searchParams.get("before"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  // The filter values and the cursor arguments are appended next to the text
  // that consumes them, so the positional bind cannot drift from the SQL.
  const where = [];
  const bind = [];
  if (status === "deleted") where.push("deleted = 1");
  else if (status !== "all") {
    where.push("deleted = 0", "status = ?");
    bind.push(status);
  }
  if (cursor) {
    where.push(cursorWhere(cursor));
    bind.push(...cursorArgs(cursor));
  }

  let sql = "SELECT id, nickname, body, created_at, avatar, author_hash, status, auto_hidden, deleted, deleted_at FROM comments";
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  bind.push(limit + 1);

  const result = await db.prepare(sql).bind(...bind).all();
  const rows = (result && result.results) || [];
  const page = rows.slice(0, limit);

  const counts = { visible: 0, hidden: 0, deleted: 0 };
  const grouped = await db
    .prepare("SELECT status, deleted, COUNT(*) AS n FROM comments GROUP BY status, deleted")
    .all();
  for (const row of (grouped && grouped.results) || []) {
    if (Number(row.deleted)) counts.deleted += Number(row.n) || 0;
    else if (row.status === "hidden") counts.hidden += Number(row.n) || 0;
    else counts.visible += Number(row.n) || 0;
  }

  return json(
    {
      comments: page.map(adminView),
      counts,
      nextBefore: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
      limits: { page: limit, body: MAX_BODY },
    },
    { request, env }
  );
}

async function adminAction({ request, env, json, id }) {
  if (!env.COMMENTS_ADMIN_TOKEN) {
    return json(
      {
        error: "not_configured",
        message: "Moderation is not switched on: set the COMMENTS_ADMIN_TOKEN secret on the Worker.",
      },
      { status: 503, request, env }
    );
  }
  if (!(await adminAuthorised(request, env))) {
    return json({ error: "forbidden", message: "That moderation token was not accepted." }, { status: 401, request, env });
  }

  const raw = await request.text().catch(() => "");
  if (raw.length > 2048) {
    return json({ error: "too_large", message: "That request is too large." }, { status: 413, request, env });
  }
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "bad_json", message: "That request was not valid JSON." }, { status: 400, request, env });
  }
  const action = String((payload && payload.action) || "");
  const db = env.COMMENTS_DB;

  let statement;
  if (action === "hide") {
    statement = db.prepare("UPDATE comments SET status = 'hidden', auto_hidden = 0 WHERE id = ? AND deleted = 0").bind(id);
  } else if (action === "show") {
    statement = db.prepare("UPDATE comments SET status = 'visible', auto_hidden = 0 WHERE id = ? AND deleted = 0").bind(id);
  } else if (action === "delete") {
    statement = db
      .prepare("UPDATE comments SET deleted = 1, status = 'hidden', body = '', deleted_at = ? WHERE id = ? AND deleted = 0")
      .bind(Date.now(), id);
  } else {
    return json({ error: "bad_action", message: "action must be hide, show or delete." }, { status: 400, request, env });
  }

  const result = await statement.run();
  const changed = Number((result && result.meta && result.meta.changes) || 0);
  if (!changed) return json({ error: "not_found", message: "No comment with that id." }, { status: 404, request, env });
  return json({ ok: true, action }, { request, env });
}

/* ---------------------------------------------------------------- routes --- */

/**
 * Handle one comments request.
 *
 * @returns {Promise<Response|null>} null when the path is not ours, so index.js
 *   can fall through to its own routes.
 */
export async function commentRoutes({ request, env, url, json, originAllowed }) {
  if (!url.pathname.startsWith("/api/comments")) return null;

  if (!env.COMMENTS_DB) {
    return json(
      {
        error: "not_configured",
        message: "Comments need the COMMENTS_DB binding, which this deployment does not have.",
      },
      { status: 503, request, env }
    );
  }

  const ip = ipOf(request);
  if (limited(`read:${ip}`, READS_PER_IP_MINUTE, 60_000)) {
    return json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, request, env });
  }

  /* ------------------------------------------------------------- admin --- */
  if (url.pathname === "/api/comments/admin") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, { status: 405, request, env });
    }
    return adminList({ request, env, url, json });
  }
  const adminMatch = /^\/api\/comments\/admin\/([A-Za-z0-9_-]{10,24})$/.exec(url.pathname);
  if (adminMatch) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, request, env });
    }
    return adminAction({ request, env, json, id: adminMatch[1] });
  }

  /* -------------------------------------------------------------- public -- */
  if (url.pathname === "/api/comments") {
    if (request.method === "GET") return listComments({ request, env, url, json });
    if (request.method === "POST") return createComment({ request, env, json, originAllowed });
    return json({ error: "Method not allowed" }, { status: 405, request, env });
  }

  const idMatch = /^\/api\/comments\/([A-Za-z0-9_-]{10,24})$/.exec(url.pathname);
  if (idMatch) {
    if (request.method === "DELETE") return deleteComment({ request, env, json, id: idMatch[1] });
    return json({ error: "Method not allowed" }, { status: 405, request, env });
  }

  return json({ error: "Not found" }, { status: 404, request, env });
}
