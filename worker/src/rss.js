/* rss.js — a small, dependency-free RSS 2.0 / Atom reader.
 *
 * Cloudflare Workers have no DOMParser, and pulling in a full XML library for
 * four known, well-formed feeds is not worth the bundle. This parser is
 * deliberately tolerant instead: it unwraps CDATA, decodes entities, strips
 * markup from descriptions, and falls back from RSS to Atom field names.
 *
 * It never throws. A feed it cannot understand yields an empty array, so one
 * broken source cannot take the whole news endpoint down.
 */

const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  "#39": "'",
};

export function decodeEntities(s = "") {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
    if (e[0] === "#") {
      const hex = e[1] === "x" || e[1] === "X";
      const n = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}

function unwrapCdata(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "");
}

function stripTags(s = "") {
  return String(s).replace(/<[^>]*>/g, " ");
}

/* Decode, strip markup, collapse whitespace. Order matters: decode last so a
 * literal "&lt;b&gt;" in a title does not become markup we then strip. */
export function clean(s = "") {
  return decodeEntities(stripTags(unwrapCdata(s))).replace(/\s+/g, " ").trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

function pickAttr(block, tag, attr) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*?\\b${attr}\\s*=\\s*["']([^"']*)["'][^>]*>`, "i"));
  return m ? m[1] : "";
}

/* Feeds are inconsistent: some send RFC-822, some ISO-8601, some nothing. An
 * unparseable date becomes null rather than NaN or "Invalid Date".
 *
 * A bare "YYYY-MM-DD HH:MM:SS" has no timezone. Date.parse would read it as the
 * host's local time - which differs between a developer's laptop and a Worker -
 * so it is pinned to UTC explicitly. */
export function parseDate(s) {
  let raw = clean(s);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
    raw = raw.replace(" ", "T") + "Z";
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function parseFeed(xml, source = "unknown") {
  const text = String(xml || "");
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  const out = [];
  for (const raw of blocks) {
    const title = clean(pick(raw, "title"));
    if (!title) continue;

    let link = clean(pick(raw, "link"));
    if (!link) link = pickAttr(raw, "link", "href"); // Atom
    // Atom is not always clean: keep only absolute http(s) links.
    link = /^https?:\/\//i.test(link) ? link : "";

    const summary = clean(
      pick(raw, "description") || pick(raw, "summary") || pick(raw, "content")
    ).slice(0, 400);

    const publishedAt = parseDate(
      pick(raw, "pubDate") ||
        pick(raw, "published") ||
        pick(raw, "updated") ||
        pick(raw, "dc:date") ||
        pickAttr(raw, "published", "value")
    );

    const guid = clean(pick(raw, "guid") || pick(raw, "id")) || link || title;

    out.push({
      id: `${source}:${guid}`.slice(0, 300),
      title,
      url: link || null,
      summary,
      source,
      publishedAt,
    });
  }
  return out;
}

/* Merge feeds, drop duplicates, newest first.
 *
 * Items with no usable date sort last rather than being discarded: they are
 * still real headlines, they just cannot be ordered. */
export function mergeNews(items, { limit = 60 } = {}) {
  const seenIds = new Set();
  const seenTitles = new Set();
  const out = [];

  for (const it of items || []) {
    if (!it || !it.title) continue;
    if (it.id && seenIds.has(it.id)) continue;
    // Cross-posted headlines show up on several outlets; keep the first.
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && seenTitles.has(key)) continue;
    if (it.id) seenIds.add(it.id);
    if (key) seenTitles.add(key);
    out.push(it);
  }

  out.sort((a, b) => {
    const A = a.publishedAt;
    const B = b.publishedAt;
    if (A == null && B == null) return 0;
    if (A == null) return 1;
    if (B == null) return -1;
    return B - A;
  });

  return out.slice(0, limit);
}
