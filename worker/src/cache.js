/* cache.js — the "one upstream call for all visitors" layer.
 *
 * Three tiers, cheapest first:
 *
 *   1. module-scope memory - per isolate, microseconds, absorbs bursts. An
 *      isolate that has served one request serves every later one for free.
 *   2. Workers KV          - global and durable, so a cold isolate still finds
 *      the value the previous one wrote.
 *   3. the producer        - the thing we are actually protecting: a paid API.
 *
 * The real guarantee comes from refreshing on a schedule (the Cron Trigger in
 * wrangler.toml) rather than from visitor traffic. Visitors then almost always
 * hit a warm entry, so the number of upstream calls tracks the clock, not the
 * audience: 10,000 visits in 30 minutes produce the same one call as 10 visits.
 *
 * `grace` adds stale-while-revalidate: an entry past its TTL is still served
 * immediately while a background refresh replaces it, so a visitor never waits
 * on the upstream API and never sees an error because of it.
 */

export function createMemory() {
  return new Map();
}

/** Per-isolate map of in-flight producers, keyed by cache key. */
export const GLOBAL_INFLIGHT = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Single-flight: while one call for this key is in progress, every other caller
 * awaits that same promise instead of starting its own. Without this, a burst of
 * concurrent requests all find the memory cache empty - because the first
 * response has not resolved yet - and all call the upstream API. This is what
 * makes "one upstream call per refresh window" true under real concurrency
 * rather than only when requests arrive one at a time. */
export function singleFlight(inflight, key, produce) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = produce().then(
    (v) => {
      inflight.delete(key);
      return v;
    },
    (e) => {
      inflight.delete(key);
      throw e;
    }
  );
  inflight.set(key, p);
  return p;
}

function fresh(entry, now, ttlMs) {
  return entry && typeof entry.at === "number" && now - entry.at < ttlMs;
}

async function readKv(kv, key) {
  if (!kv) return null;
  try {
    const raw = await kv.get(key, "json");
    // KV can hold a non-object if something else wrote the key.
    return raw && typeof raw === "object" && "value" in raw ? raw : null;
  } catch {
    return null;
  }
}

async function writeKv(kv, key, entry) {
  if (!kv) return;
  try {
    // Keep the entry well past its TTL so it can still be served stale.
    await kv.put(key, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 });
  } catch {
    /* KV being unavailable must not fail the request. */
  }
}

/* Best-effort single-flight. KV is eventually consistent, so this is not a real
 * distributed mutex - two isolates can both miss the lock. It reliably collapses
 * a burst inside one isolate (which is where a stampede starts) and the cron
 * refresh makes the cold path rare in the first place. */
async function acquireLock(kv, key) {
  if (!kv) return true;
  try {
    if (await kv.get(key)) return false;
    await kv.put(key, String(Date.now()), { expirationTtl: 30 });
    return true;
  } catch {
    return true; // fail open: better a duplicate call than a broken endpoint
  }
}

async function releaseLock(kv, key) {
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch {
    /* the 30s TTL will clear it */
  }
}

/**
 * @param {object}   opts
 * @param {KVNamespace|null} opts.kv      durable global cache (may be null)
 * @param {Map}      opts.mem             per-isolate cache
 * @param {string}   opts.key
 * @param {number}   opts.ttlSeconds      how long a value counts as fresh
 * @param {number}   opts.graceSeconds    how long past that it may still be served
 * @param {Function} opts.produce         async () => value  (the upstream call)
 * @param {object}   opts.ctx             Cloudflare ExecutionContext, for waitUntil
 * @param {object}   opts.meta            extra fields merged into the response
 * @param {Function} opts.now             injectable clock (tests)
 */
export async function cached({
  kv = null,
  mem = createMemory(),
  inflight = GLOBAL_INFLIGHT,
  key,
  ttlSeconds,
  graceSeconds = ttlSeconds * 2,
  produce,
  ctx = null,
  meta = {},
  now = () => Date.now(),
}) {
  const ttlMs = ttlSeconds * 1000;
  const graceMs = graceSeconds * 1000;
  const lockKey = `${key}:lock`;

  const background = (p) => {
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    else p.catch(() => {});
  };

  // ---- tier 1: per-isolate memory -----------------------------------------
  const local = mem.get(key);
  if (fresh(local, now(), ttlMs)) {
    return { value: local.value, cached: true, stale: false, ageSeconds: Math.round((now() - local.at) / 1000), ...meta };
  }

  // ---- tier 2: global KV ---------------------------------------------------
  const stored = await readKv(kv, key);
  if (stored) {
    const age = now() - stored.at;
    if (age < ttlMs) {
      mem.set(key, stored);
      return { value: stored.value, cached: true, stale: false, ageSeconds: Math.round(age / 1000), ...meta };
    }
    if (age < graceMs) {
      mem.set(key, stored);
      // Serve it now, replace it in the background.
      background(refresh({ kv, mem, inflight, key, produce, now }));
      return { value: stored.value, cached: true, stale: true, ageSeconds: Math.round(age / 1000), ...meta };
    }
  }

  // ---- tier 3: produce -----------------------------------------------------
  const gotLock = await acquireLock(kv, lockKey);
  if (!gotLock) {
    // Another worker is producing. Wait briefly, then fall back to the stale
    // copy rather than making a second upstream call.
    for (let i = 0; i < 12; i++) {
      await sleep(150);
      const again = await readKv(kv, key);
      if (again) {
        mem.set(key, again);
        return { value: again.value, cached: true, stale: true, ageSeconds: Math.round((now() - again.at) / 1000), ...meta };
      }
      if (fresh(mem.get(key), now(), ttlMs)) {
        const m = mem.get(key);
        return { value: m.value, cached: true, stale: true, ageSeconds: Math.round((now() - m.at) / 1000), ...meta };
      }
    }
    if (stored) {
      return { value: stored.value, cached: true, stale: true, ageSeconds: Math.round((now() - stored.at) / 1000), ...meta };
    }
  }

  try {
    // Collapses every concurrent caller for this key into one upstream call.
    const value = await singleFlight(inflight, key, produce);
    const entry = { at: now(), value };
    mem.set(key, entry);
    await writeKv(kv, key, entry);
    return { value, cached: false, stale: false, ageSeconds: 0, ...meta };
  } finally {
    if (gotLock) await releaseLock(kv, lockKey);
  }
}

async function refresh({ kv, mem, inflight, key, produce, now }) {
  try {
    const value = await singleFlight(inflight, key, produce);
    const entry = { at: now(), value };
    mem.set(key, entry);
    await writeKv(kv, key, entry);
  } catch {
    /* keep serving the stale value; the cron will try again */
  }
}

/** Force a rebuild. Used by the Cron Trigger so traffic never pays for it. */
export async function warm(opts) {
  const {
    produce,
    key,
    mem = createMemory(),
    kv = null,
    inflight = GLOBAL_INFLIGHT,
    now = () => Date.now(),
  } = opts;
  const value = await singleFlight(inflight, key, produce);
  const entry = { at: now(), value };
  mem.set(key, entry);
  await writeKv(kv, key, entry);
  return entry;
}
