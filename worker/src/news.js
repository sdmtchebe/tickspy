/* news.js — multi-source market news aggregation.
 *
 * Why RSS rather than one vendor API: these outlets publish continuously, cost
 * nothing, need no key, and have no quota. Measured freshness at the time of
 * writing was 29-32 minutes for the top three. Six independent sources also
 * means one outlet going down degrades coverage instead of breaking the feed.
 *
 * Every URL below was fetched and validated before being included; several
 * popular-looking alternatives were dropped because they were stale or dead
 * (Yahoo's index feed ~10 days old, WSJ Markets and MarketWatch Market Pulse
 * serving effectively frozen documents, Barron's and CNBC Economy 403/404).
 *
 * Aggregation happens here, server-side, because these feeds send no CORS
 * headers and a browser could not read them directly.
 */

import { parseFeed, mergeNews } from "./rss.js";

export const FEEDS = [
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { source: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news_25.rss" },
  { source: "CNBC US", url: "https://www.cnbc.com/id/15837362/device/rss/rss.html" },
  { source: "Nasdaq", url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets" },
  { source: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Fetch every feed in parallel, merge and dedupe. Never throws: a source that
 * fails is reported in `sources` and simply contributes nothing.
 */
export async function collectNews({ fetcher = fetch, limit = 60, q = "", now = Date.now } = {}) {
  const results = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const res = await fetcher(f.url, {
          headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
          // Let Cloudflare's own edge cache absorb repeat polling of the feeds.
          cf: { cacheTtl: 120, cacheEverything: true },
        });
        if (!res.ok) {
          return { source: f.source, ok: false, status: res.status, items: [], error: `HTTP ${res.status}` };
        }
        const xml = await res.text();
        const items = parseFeed(xml, f.source);
        return { source: f.source, ok: true, status: res.status, items };
      } catch (e) {
        return { source: f.source, ok: false, status: 0, items: [], error: String((e && e.message) || e) };
      }
    })
  );

  let news = mergeNews(
    results.flatMap((r) => r.items),
    { limit }
  );

  if (q) {
    const needle = q.toLowerCase();
    news = news.filter(
      (n) =>
        n.title.toLowerCase().includes(needle) ||
        (n.summary || "").toLowerCase().includes(needle)
    );
  }

  return {
    news,
    sources: results.map((r) => ({
      source: r.source,
      ok: r.ok,
      status: r.status,
      items: r.items.length,
      error: r.error || null,
    })),
    sourcesOk: results.filter((r) => r.ok).length,
    sourcesTotal: results.length,
    fetchedAt: new Date(now()).toISOString(),
  };
}
