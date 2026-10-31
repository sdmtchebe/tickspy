// Client for the anonymous community wall, and the identity that makes a
// comment "yours".
//
// The identity is 32 random bytes generated in this browser and kept in
// localStorage. It is not an account: the server sees a bearer token, stores
// only a SHA-256 digest of it, and derives the nickname from that digest. There
// is no email, no IP and no cookie, so there is nothing to correlate with a
// real person.
//
// Clearing site data creates a new identity — the old comments stay, but they
// are no longer deletable from this browser. That is the honest trade of an
// anonymous system with no recovery channel, and the UI says so.

import { EDGE_API } from "./edge";

const API_BASE = EDGE_API;

const STORAGE_KEY = "tickspy-community-key";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// A module-level fallback for private modes where localStorage throws. The key
// then lasts for the session instead of forever, which still lets a visitor
// post and delete in one visit.
let sessionKey = null;

export function identityKey() {
  if (sessionKey) return sessionKey;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (TOKEN_RE.test(stored || "")) {
      sessionKey = stored;
      return stored;
    }
  } catch (_) {
    // Blocked storage: fall through and make a session-only identity.
  }

  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const key = window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  sessionKey = key;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch (_) {
    // Session-only is acceptable; the UI explains what that costs.
  }
  return key;
}

/** False when the identity exists only for this tab (storage was unavailable). */
export function identityIsPersistent() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === identityKey();
  } catch (_) {
    return false;
  }
}

function withTimeout(signal, ms = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function request(path, { method = "GET", body, signal } = {}) {
  const timeout = withTimeout(signal);
  try {
    const res = await fetch(`${API_BASE}/api/comments${path}`, {
      method,
      mode: "cors",
      credentials: "omit",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${identityKey()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.message || "The community wall is unavailable right now.");
      error.code = data.error || `http_${res.status}`;
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("The community wall took too long to answer.");
      timeoutError.code = "timeout";
      throw timeoutError;
    }
    if (!error.code) error.code = "network";
    throw error;
  } finally {
    timeout.done();
  }
}

export function listComments({ before, signal } = {}) {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return request(query, { signal });
}

/**
 * `turnstileToken` is sent only when the page found a Turnstile site key in the
 * feed. The Worker ignores it unless its own gate is configured, so a stale
 * page and a new Worker (or the reverse) still work.
 */
export function postComment(body, turnstileToken) {
  return request("", {
    method: "POST",
    body: turnstileToken ? { body, turnstileToken } : { body },
  });
}

export function deleteComment(id) {
  return request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export { API_BASE };
