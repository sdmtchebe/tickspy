/* Tests for the anonymous comment wall.
 *
 *   cd worker && node tests/comments.js
 *
 * The real database needs Miniflare, so the route tests below use a small
 * in-memory stand-in that understands exactly the four statements comments.js
 * issues. That is enough to test the properties that matter — ownership on
 * delete, the Origin gate, rate limits, held comments — against the real
 * handler. The SQL itself is checked end-to-end against a real D1 database by
 * `wrangler dev --local` (see README.md, "Testing the comments API").
 */

import assert from "node:assert/strict";

import worker from "../src/index.js";
import {
  MAX_BODY,
  _clearRateLimits,
  authorHash,
  cleanBody,
  identityOk,
  nicknameFor,
  randomId,
  safeEqual,
  spamReason,
} from "../src/comments.js";

let passed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok   ${name}`);
    })
    .catch((error) => {
      failures.push({ name, error });
      console.log(`  FAIL ${name}\n         ${(error && error.message) || error}`);
      if (error && error.stack) console.log(`         ${error.stack.split("\n")[1].trim()}`);
    });
}

/* ------------------------------------------------------------------ fake db */

function memoryDb() {
  const rows = [];

  function stmt(sql) {
    const self = {
      sql,
      args: [],
      bind(...args) {
        self.args = args;
        return self;
      },
      async first() {
        if (sql.startsWith("SELECT COUNT(*) AS n FROM comments WHERE author_hash = ?")) {
          const [hash, since] = self.args;
          return { n: rows.filter((r) => r.author_hash === hash && r.created_at > since).length };
        }
        if (sql.startsWith("SELECT created_at FROM comments WHERE author_hash = ?")) {
          const [hash] = self.args;
          const stamped = rows.filter((r) => r.author_hash === hash).map((r) => r.created_at);
          return stamped.length ? { created_at: Math.max(...stamped) } : null;
        }
        if (sql.startsWith("SELECT 1 AS n FROM comments WHERE body_hash = ?")) {
          const [hash, since] = self.args;
          return rows.some((r) => r.body_hash === hash && r.created_at > since) ? { n: 1 } : null;
        }
        if (sql.startsWith("SELECT COUNT(*) AS n FROM comments WHERE deleted = 0")) {
          return { n: rows.filter((r) => !r.deleted && r.status === "visible").length };
        }
        throw new Error(`unexpected first(): ${sql}`);
      },
      async all() {
        if (sql.includes("GROUP BY status, deleted")) {
          const seen = new Map();
          for (const r of rows) {
            const key = `${r.status}:${r.deleted}`;
            seen.set(key, (seen.get(key) || 0) + 1);
          }
          return {
            results: [...seen.entries()].map(([key, n]) => {
              const [status, deleted] = key.split(":");
              return { status, deleted: Number(deleted), n };
            }),
          };
        }
        const isAdmin = sql.startsWith("SELECT id, nickname, body, created_at, avatar, author_hash, status");
        const isFeed = sql.startsWith("SELECT id, nickname, body, created_at, avatar, author_hash FROM comments");
        if (!isAdmin && !isFeed) throw new Error(`unexpected all(): ${sql}`);

        // The handler appends the cursor arguments next to the text that uses
        // them, so the tail of the bind is always: [cursor values…], limit.
        // A composite cursor contributes three values, a legacy one.
        const limit = self.args[self.args.length - 1];
        const composite = sql.includes("id < ?");
        const at = composite
          ? self.args[self.args.length - 3]
          : sql.includes("created_at < ?")
            ? self.args[self.args.length - 2]
            : Infinity;
        const tieId = composite ? self.args[self.args.length - 2] : null;
        const statusFilter = isAdmin && sql.includes("status = ?") ? self.args[0] : null;

        const picked = rows
          .filter((r) => (isFeed ? !r.deleted && r.status === "visible" : true))
          .filter((r) => (isAdmin && sql.includes("deleted = 1") ? r.deleted : true))
          .filter((r) => (isAdmin && sql.includes("deleted = 0") ? !r.deleted : true))
          .filter((r) => (statusFilter ? r.status === statusFilter : true))
          .filter((r) => r.created_at < at || (tieId !== null && r.created_at === at && r.id < tieId))
          .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
          .slice(0, limit);
        return { results: picked };
      },
      async run() {
        if (sql.startsWith("INSERT INTO comments")) {
          const [id, created_at, body, body_hash, nickname, author_hash, avatar, status, auto_hidden] = self.args;
          if (rows.some((r) => r.id === id)) throw new Error("UNIQUE constraint failed");
          rows.push({
            id, created_at, body, body_hash, nickname, author_hash, avatar,
            status, auto_hidden, deleted: 0, deleted_at: null,
          });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE comments SET status")) {
          const [id] = self.args;
          const row = rows.find((r) => r.id === id && !r.deleted);
          if (!row) return { meta: { changes: 0 } };
          row.status = sql.includes("'visible'") ? "visible" : "hidden";
          row.auto_hidden = 0;
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE comments SET deleted = 1")) {
          const [deleted_at, id, hash] = self.args;
          const row = rows.find((r) => r.id === id && r.author_hash === hash && !r.deleted);
          if (!row) return { meta: { changes: 0 } };
          row.deleted = 1;
          row.status = "hidden";
          row.body = "";
          row.deleted_at = deleted_at;
          return { meta: { changes: 1 } };
        }
        throw new Error(`unexpected run(): ${sql}`);
      },
    };
    return self;
  }

  return { rows, prepare: stmt };
}

const ORIGIN = "https://tickspy.com";
const tok = (fill) => fill.repeat(Math.ceil(43 / fill.length)).slice(0, 43);

function envFor(db, extra = {}) {
  return {
    COMMENTS_DB: db,
    COMMENTS_ADMIN_TOKEN: "moderation-token-that-is-long-enough",
    ALLOWED_ORIGINS: ORIGIN,
    ...extra,
  };
}

async function call(env, path, { method = "GET", token, body, origin = ORIGIN } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    {}
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* ------------------------------------------------------------------- tests */

async function main() {
  console.log("comments.js: text handling");

  await test("keeps newlines and trims, drops controls and zero-width tricks", () => {
    const r = cleanBody("  Hello\n\n\nworld \u200B\u202Ethere\u0007  ");
    assert.equal(r.value, "Hello\n\nworld there");
    assert.equal(cleanBody("a\u0000bc").value, "abc");
  });

  await test("rejects empty, short and oversized bodies", () => {
    assert.equal(cleanBody("   ").error, "too_short");
    assert.equal(cleanBody("hi").error, "too_short");
    assert.equal(cleanBody(42).error, "bad_body");
    assert.equal(cleanBody("x".repeat(MAX_BODY + 1)).error, "too_long");
    assert.equal(cleanBody("x".repeat(MAX_BODY)).value.length, MAX_BODY);
  });

  await test("keeps the joiners emoji and Indic text need, drops bidi controls", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    assert.equal(cleanBody(`${family} note`).value, `${family} note`, "ZWJ must survive a family emoji");
    assert.ok(!cleanBody("alpha\u202Ebravo").value.includes("\u202E"), "an RLO override is dropped");
    assert.ok(!cleanBody("alpha\u061Cbravo").value.includes("\u061C"), "the Arabic letter mark is dropped");
    assert.ok(!cleanBody("alpha\u200Bbravo").value.includes("\u200B"), "a zero-width space is dropped");
  });

  console.log("comments.js: identity");

  await test("a nickname is deterministic, readable and derived from the hash", async () => {
    const a = await authorHash(tok("a"));
    const b = await authorHash(tok("b"));
    assert.match(nicknameFor(a), /^[A-Z][a-z]+ [A-Z][a-z]+ #\d{4}$/);
    assert.equal(nicknameFor(a), nicknameFor(a));
    assert.notEqual(nicknameFor(a), nicknameFor(b));
  });

  await test("the same token always hashes the same way, and never to the token", async () => {
    const hash = await authorHash(tok("z"));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, await authorHash(tok("z")));
    assert.notEqual(hash, await authorHash(tok("y")));
    assert.ok(!hash.includes(tok("z")));
  });

  await test("only 43-character base64url tokens are accepted", () => {
    assert.equal(identityOk("A".repeat(43)), true);
    assert.equal(identityOk("A".repeat(42)), false);
    assert.equal(identityOk("A".repeat(44)), false);
    assert.equal(identityOk("<script>alert(1)</script>"), false);
    assert.equal(identityOk("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"), false);
    assert.equal(identityOk(null), false);
  });

  await test("safeEqual compares secrets without throwing on length", async () => {
    assert.equal(await safeEqual("abc", "abc"), true);
    assert.equal(await safeEqual("abc", "abd"), false);
    assert.equal(await safeEqual("a", "aaaaaaaaaaaaaaaaaaaa"), false);
  });

  await test("ids are short, unique and url-safe", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const id = randomId();
      assert.match(id, /^[A-Za-z0-9_-]{10,24}$/);
      seen.add(id);
    }
    assert.equal(seen.size, 500);
  });

  console.log("comments.js: filters");

  await test("ordinary conversation is not held", () => {
    for (const body of [
      "The volatility panel helped me understand HAR better. Thanks.",
      "VWAP was above the close all afternoon, so I waited. Worked for me.",
      "How do I set an alert at 105 if the current price is 100?",
      "this is great",
    ]) {
      assert.equal(spamReason(body), null, body);
    }
  });

  await test("abuse, links, shouting, repetition and markup are held", () => {
    assert.equal(spamReason("join my telegram group for signals"), "solicitation");
    assert.equal(spamReason("see https://a.example https://b.example https://c.example"), "links");
    assert.equal(spamReason("!!!!!!!!!!!!!!!!!!!!!!!!"), "repetition");
    assert.equal(spamReason("<script>alert(1)</script>"), "markup");
    assert.equal(spamReason("BUY THIS NOW IT IS GUARANTEED TO GO UP FOREVER AND EVER AND EVER"), "shouting");
  });

  await test("the hold list matches whole words, not fragments", () => {
    for (const body of [
      "The spices were not the problem with the setup.",
      "That was not conspicuous at all, honestly.",
      "The retardant in the candle is not a market signal.",
    ]) {
      assert.equal(spamReason(body), null, body);
    }
    assert.equal(spamReason("you absolute spic"), "abuse");
  });

  console.log("comments.js: routes");

  await test("unrelated paths are not handled here", async () => {
    const db = memoryDb();
    const { status } = await call(envFor(db), "/api/health");
    assert.equal(status, 200); // index.js answers, comments returns null
  });

  await test("no database binding gives a plain 503", async () => {
    const { status, body } = await call({ ALLOWED_ORIGINS: ORIGIN }, "/api/comments");
    assert.equal(status, 503);
    assert.equal(body.error, "not_configured");
  });

  await test("posting from another origin is refused before the database", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const { status } = await call(envFor(db), "/api/comments", {
      method: "POST",
      token: tok("a"),
      body: { body: "hello there" },
      origin: "https://evil.example",
    });
    assert.equal(status, 403);
    assert.equal(db.rows.length, 0);
  });

  await test("posting without an identity is refused", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const { status, body } = await call(envFor(db), "/api/comments", {
      method: "POST",
      body: { body: "hello there" },
    });
    assert.equal(status, 401);
    assert.equal(body.error, "no_identity");
    assert.equal(db.rows.length, 0);
  });

  await test("only the owner can delete a comment", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const owner = tok("a");
    const other = tok("b");

    const posted = await call(envFor(db), "/api/comments", {
      method: "POST",
      token: owner,
      body: { body: "This is my note about the RSI panel." },
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.comment.mine, true);
    assert.equal(db.rows.length, 1);
    const id = posted.body.comment.id;

    const stranger = await call(envFor(db), `/api/comments/${id}`, { method: "DELETE", token: other });
    assert.equal(stranger.status, 404, "a stranger must not be able to delete it");
    assert.equal(db.rows[0].deleted, 0);

    const feedForStranger = await call(envFor(db), "/api/comments", { token: other });
    assert.equal(feedForStranger.body.comments[0].mine, false);
    assert.equal(feedForStranger.body.comments[0].body, "This is my note about the RSI panel.");

    const mine = await call(envFor(db), `/api/comments/${id}`, { method: "DELETE", token: owner });
    assert.equal(mine.status, 200);
    assert.equal(db.rows[0].deleted, 1);
    assert.equal(db.rows[0].body, "", "the text is wiped, not merely hidden");

    const feed = await call(envFor(db), "/api/comments", { token: owner });
    assert.equal(feed.body.comments.length, 0);
  });

  await test("the feed marks ownership only for the caller", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const me = tok("m");
    await call(envFor(db), "/api/comments", { method: "POST", token: me, body: { body: "first note" } });
    const feed = await call(envFor(db), "/api/comments", { token: me });
    assert.equal(feed.body.comments[0].mine, true);
    assert.equal(feed.body.you.nickname, nicknameFor(await authorHash(me)));
    assert.equal(feed.body.total, 1);
  });

  await test("pagination pages backwards without repeating or losing a comment", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const env = envFor(db);
    for (const [i, token] of [tok("e"), tok("f"), tok("g")].entries()) {
      const r = await call(env, "/api/comments", {
        method: "POST",
        token,
        body: { body: `paged note number ${i}` },
      });
      assert.equal(r.status, 201);
      await new Promise((done) => setTimeout(done, 3));
    }

    const first = await call(env, "/api/comments?limit=2");
    assert.equal(first.body.comments.length, 2);
    assert.equal(first.body.total, 3);
    assert.ok(first.body.nextBefore, "a full page must report a cursor");

    const second = await call(env, `/api/comments?limit=2&before=${first.body.nextBefore}`);
    assert.equal(second.body.comments.length, 1);
    assert.equal(second.body.nextBefore, null);
    assert.equal(second.body.total, undefined, "the count belongs to the first page only");

    const ids = new Set([...first.body.comments, ...second.body.comments].map((c) => c.id));
    assert.equal(ids.size, 3, "the two pages must not repeat an id");
  });

  await test("two comments written in the same millisecond both survive paging", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const at = Date.now();
    for (const [i, id] of ["aaaaaaaaaaaa", "bbbbbbbbbbbb"].entries()) {
      db.rows.push({
        id,
        created_at: at,
        body: `tied note ${i}`,
        body_hash: `tied-${i}`,
        nickname: "Tied Otter #1000",
        author_hash: `author-${i}`,
        avatar: 0,
        status: "visible",
        auto_hidden: 0,
        deleted: 0,
        deleted_at: null,
      });
    }

    const first = await call(envFor(db), "/api/comments?limit=1");
    assert.equal(first.body.comments.length, 1);
    assert.match(first.body.nextBefore, /^\d+_[A-Za-z0-9_-]{10,24}$/, "the cursor must carry the id");

    const second = await call(envFor(db), `/api/comments?limit=1&before=${first.body.nextBefore}`);
    assert.equal(second.body.comments.length, 1, "the twin must not be skipped");
    assert.notEqual(second.body.comments[0].id, first.body.comments[0].id);
    assert.equal(second.body.nextBefore, null);
  });

  await test("markup is stored as text and never converted to a field", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const posted = await call(envFor(db), "/api/comments", {
      method: "POST",
      token: tok("s"),
      body: { body: "<img src=x onerror=alert(1)> hello" },
    });
    assert.equal(posted.status, 201);
    assert.equal(posted.body.held, true, "injection-shaped text is held for review");
    assert.equal(db.rows[0].body, "<img src=x onerror=alert(1)> hello");
    assert.equal(db.rows[0].status, "hidden");
  });

  await test("a comment longer than the limit is refused with a real number", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const { status, body } = await call(envFor(db), "/api/comments", {
      method: "POST",
      token: tok("l"),
      body: { body: "x".repeat(MAX_BODY + 1) },
    });
    assert.equal(status, 413);
    assert.match(body.message, new RegExp(String(MAX_BODY)));
    assert.equal(db.rows.length, 0);
  });

  await test("the same text from a new identity is caught as a duplicate", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const text = "I made 400% in one week with this secret method";
    const first = await call(envFor(db), "/api/comments", { method: "POST", token: tok("1"), body: { body: text } });
    assert.equal(first.status, 201);
    const second = await call(envFor(db), "/api/comments", { method: "POST", token: tok("2"), body: { body: text } });
    assert.equal(second.status, 409);
    assert.equal(db.rows.length, 1);
  });

  await test("a second comment seconds later is rate limited", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const token = tok("r");
    await call(envFor(db), "/api/comments", { method: "POST", token, body: { body: "first comment" } });
    const again = await call(envFor(db), "/api/comments", { method: "POST", token, body: { body: "second comment" } });
    assert.equal(again.status, 429);
    assert.match(again.body.message, /second/);
  });

  await test("moderation needs its own token, and it is not the identity token", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const env = envFor(db);

    const anonymous = await call(env, "/api/comments/admin", { token: tok("a") });
    assert.equal(anonymous.status, 401);

    const noToken = await call(env, "/api/comments/admin");
    assert.equal(noToken.status, 401);

    const admin = await call(env, "/api/comments/admin", { token: env.COMMENTS_ADMIN_TOKEN });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.counts.visible, 0);

    const unset = await call(envFor(db, { COMMENTS_ADMIN_TOKEN: "" }), "/api/comments/admin");
    assert.equal(unset.status, 503);
  });

  await test("the moderation queue filters and pages without losing a row", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const env = envFor(db);
    const admin = { token: env.COMMENTS_ADMIN_TOKEN };

    for (const [i, token] of [tok("w"), tok("x")].entries()) {
      const r = await call(env, "/api/comments", {
        method: "POST",
        token,
        body: { body: `moderation note ${i}` },
      });
      assert.equal(r.status, 201);
      await new Promise((done) => setTimeout(done, 3));
    }
    const held = await call(env, "/api/comments", {
      method: "POST",
      token: tok("y"),
      body: { body: "<script>held for a person to read</script>" },
    });
    assert.equal(held.body.held, true);

    const all = await call(env, "/api/comments/admin?status=all&limit=2", admin);
    assert.equal(all.status, 200);
    assert.equal(all.body.comments.length, 2);
    assert.ok(all.body.nextBefore, "a full moderation page needs a cursor");
    assert.deepEqual(all.body.counts, { visible: 2, hidden: 1, deleted: 0 });

    const next = await call(env, `/api/comments/admin?status=all&limit=2&before=${all.body.nextBefore}`, admin);
    assert.equal(next.body.comments.length, 1);
    assert.equal(next.body.nextBefore, null);

    const hidden = await call(env, "/api/comments/admin?status=hidden", admin);
    assert.equal(hidden.body.comments.length, 1);
    assert.match(hidden.body.comments[0].body, /script/);

    // `all` is newest first: the held script comment is [0], the visible notes
    // follow. Hide a visible one, otherwise the test would only re-hide the
    // held comment and the count would not move.
    const hide = await call(env, `/api/comments/admin/${all.body.comments[1].id}`, {
      method: "POST",
      token: env.COMMENTS_ADMIN_TOKEN,
      body: { action: "hide" },
    });
    assert.equal(hide.status, 200);
    const afterHide = await call(env, "/api/comments/admin?status=visible", admin);
    assert.equal(afterHide.body.comments.length, 1);
  });

  await test("CORS advertises DELETE and Authorization and grants only known origins", async () => {
    const env = envFor(memoryDb());
    const good = await worker.fetch(
      new Request("https://api.test/api/comments", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      env,
      {}
    );
    assert.equal(good.status, 204);
    assert.match(good.headers.get("Access-Control-Allow-Methods"), /DELETE/);
    assert.match(good.headers.get("Access-Control-Allow-Headers"), /Authorization/);
    assert.equal(good.headers.get("Access-Control-Allow-Origin"), ORIGIN);

    const bad = await worker.fetch(
      new Request("https://api.test/api/comments", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
      env,
      {}
    );
    assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  });

  console.log("comments.js: the bot gate");

  await test("with the gate configured, a post without a token is refused", async () => {
    _clearRateLimits();
    const db = memoryDb();
    const env = envFor(db, { TURNSTILE_SITE_KEY: "0xTEST", TURNSTILE_SECRET_KEY: "turnstile-secret" });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const sent = init.body && typeof init.body.get === "function" ? init.body.get("response") : null;
      const success = sent === "token-from-widget";
      return new Response(JSON.stringify({ success }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      const missing = await call(env, "/api/comments", {
        method: "POST",
        token: tok("t"),
        body: { body: "a real note about the desk" },
      });
      assert.equal(missing.status, 403);
      assert.equal(missing.body.error, "turnstile_failed");
      assert.equal(db.rows.length, 0, "nothing is stored without a pass");

      const passed = await call(env, "/api/comments", {
        method: "POST",
        token: tok("t"),
        body: { body: "a real note about the desk", turnstileToken: "token-from-widget" },
      });
      assert.equal(passed.status, 201);
      assert.equal(db.rows.length, 1);
      assert.equal(passed.body.comment.turnstileToken, undefined, "the token is never echoed");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("the feed advertises the site key only when the gate has both halves", async () => {
    const db = memoryDb();
    const off = await call(envFor(db), "/api/comments");
    assert.equal(off.body.turnstile, null);

    const half = await call(envFor(db, { TURNSTILE_SECRET_KEY: "only-the-secret" }), "/api/comments");
    assert.equal(half.body.turnstile, null, "half a configuration must not advertise a widget");

    const on = await call(envFor(db, { TURNSTILE_SITE_KEY: "0xTEST", TURNSTILE_SECRET_KEY: "s" }), "/api/comments");
    assert.equal(on.body.turnstile.siteKey, "0xTEST");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
