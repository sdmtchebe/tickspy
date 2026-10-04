/* gemini.js — the only place the Gemini key is ever used.
 *
 * Security properties, all deliberate:
 *
 *   - The key comes from env.GEMINI_API_KEY (a Worker secret) and is passed in,
 *     never read from a module-level constant, never logged, and never returned.
 *   - The endpoint accepts NO user text. The prompt is assembled entirely from
 *     server-side data (our own aggregated headlines and calendar). There is no
 *     path by which a visitor can inject instructions, which is what stops this
 *     from being an open proxy for other people's API abuse.
 *   - Output length and temperature are bounded, so a single call has a
 *     predictable, small token cost.
 */

export const DEFAULT_MODEL = "gemini-flash-lite-latest";

const SYSTEM = [
  "You are a factual market-news summariser embedded in a trading dashboard.",
  "Write 3 to 4 short bullets about what the supplied headlines and scheduled events say.",
  "State only what the sources state. Do not interpret, do not speculate about causes,",
  "do not predict prices or market direction, and do not say whether anything is good or bad.",
  "Never mention buying, selling, holding, positions or allocation.",
  "If the material is thin, duplicated or stale, say so plainly instead of padding it out.",
  "Plain text only: no markdown headings, no bold, no bullet symbols beyond a leading '- '.",
].join(" ");

/** Trim the inputs so the prompt - and therefore the bill - stays small. */
export function buildPrompt({ news = [], events = [], maxHeadlines = 20, maxEvents = 8 } = {}) {
  const headlines = news
    .slice(0, maxHeadlines)
    .map((n) => `- [${n.source}] ${n.title}`)
    .join("\n");

  const upcoming = events
    .slice(0, maxEvents)
    .map((e) => `- ${e.when} ${e.title} (${e.impact}${e.forecast ? `, forecast ${e.forecast}` : ""})`)
    .join("\n");

  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return [
    `Current time: ${now}`,
    "",
    "Latest market headlines:",
    headlines || "(none available)",
    "",
    "Scheduled economic events:",
    upcoming || "(none available)",
    "",
    "Summarise the above in 3 to 4 bullets.",
  ].join("\n");
}

/**
 * @returns {Promise<{text:string, model:string, usage:object|null}>}
 * Throws on failure so the caller can decide whether to serve a stale value.
 */
export async function generateOverview({
  apiKey,
  model = DEFAULT_MODEL,
  news = [],
  events = [],
  fetchImpl = fetch,
  timeoutMs = 20000,
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt({ news, events }) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 400, topP: 0.9 },
    // Keep the model from running away on a long prompt.
    safetySettings: [],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Never echo the raw body: it can contain quota details tied to the key.
    throw new Error(`Gemini responded ${res.status}`);
  }

  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts) || [];
  const text = parts
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!text) {
    const reason =
      (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || "unknown";
    throw new Error(`Gemini returned no text (finishReason: ${reason})`);
  }

  return { text, model, usage: data.usageMetadata || null };
}
