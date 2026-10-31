/* Live check against a locally running `wrangler dev` Worker (workerd + local KV).
 *
 *   cd worker && node scripts/live-check.mjs
 *
 * The Node test suites stub the network and run the code in Node. This drives the
 * same endpoints inside the real runtime, with a real KV namespace, so it catches
 * what only workerd can catch: a module the runtime refuses to load, a binding it
 * cannot resolve, a header it rejects, a Request body it will not re-read.
 *
 * There is nothing personal left to check here: alerts are made in the browser
 * and never reach this API, so the surface is the read-only routes plus the
 * comment wall's Origin gate. What follows asserts exactly that shape — and that
 * a route which used to exist now answers 404 instead of half-working.
 */

const BASE = process.env.BASE || "http://127.0.0.1:8791";
const ORIGIN = "https://tickspy.com";

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

const out = [];
const note = (ok, label, detail = "") => {
  out.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`live check against ${BASE}\n`);

// 1. Health: configuration as booleans, never a value.
const health = await call("/api/health", { method: "GET" });
const leaked = [health.text.includes("BEGIN"), health.text.includes("AAAA")].some(Boolean);
note(
  health.status === 200 && !leaked && health.json?.configured?.comments !== undefined,
  "/api/health reports configuration as booleans and leaks no secret",
  `status ${health.status}`
);

// 2. The CORS grant is for one origin, and an unlisted origin gets nothing.
const granted = await call("/api/health", { method: "GET" });
note(granted.cors === ORIGIN, "an allowed origin is granted CORS", `grant ${granted.cors}`);
const refused = await call("/api/health", { method: "GET", origin: "https://evil.example" });
note(refused.cors === null, "an unknown origin is granted nothing", `grant ${refused.cors}`);

// 3. A read-only route answers inside workerd, on JSON.
const overview = await call("/api/overview", { method: "GET", origin: null });
note(
  [200, 502, 503].includes(overview.status) && overview.json !== null,
  "/api/overview answers inside workerd",
  `status ${overview.status}`
);

// 4. The retired alert routes are gone rather than half-working: 404, JSON,
//    and not a single endpoint name left in the list.
const gone = await call("/api/alerts/config", { method: "GET" });
note(
  gone.status === 404 && Array.isArray(gone.json?.endpoints) && !gone.text.includes("telegram"),
  "the old alert routes answer 404 with no trace of the removed channel",
  `status ${gone.status} · ${gone.json?.endpoints?.length} endpoints listed`
);

// 5. The comment wall is the only writer, and it is origin-gated.
const crossOrigin = await call("/api/comments", { body: { body: "hello" }, origin: "https://evil.example" });
note(crossOrigin.status === 403, "a cross-site comment is refused", `status ${crossOrigin.status}`);
const noOrigin = await call("/api/comments", { body: { body: "hello" }, origin: null });
note(noOrigin.status === 403, "a comment with no Origin is refused", `status ${noOrigin.status}`);

// 6. A comment from the allowed origin passes the gate; whatever happens after
//    it (a local database that is not migrated yet answers honestly) is the
//    database's business, not a crash.
const allowed = await call("/api/comments", { body: { body: "live check" } });
note(
  allowed.status !== 403 && allowed.status < 600 && allowed.json !== null,
  "an allowed origin passes the gate and gets a JSON answer",
  `status ${allowed.status} · ${allowed.json?.error || "ok"}`
);

console.log(`\n${out.filter((r) => r.ok).length}/${out.length} checks passed`);
if (out.some((r) => !r.ok)) process.exit(1);
