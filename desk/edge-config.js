/*
 * TickSPY desk — edge API address.
 *
 * The desk is a static page. Everything that needs a server (Gemini with a
 * hidden key, market headlines from feeds that send no CORS headers, a fresh
 * economic calendar) is served by the small Cloudflare Worker in ../worker.
 * See worker/README.md for how to deploy it.
 *
 * Set the deployed Worker's origin below, e.g.:
 *
 *     window.DESK_EDGE_API = "https://tickspy-api.<your-subdomain>.workers.dev";
 *
 * This URL is load-bearing, not optional. It is where the desk's no-key price
 * data comes from (`GET /api/bars`), along with the aggregated market headlines,
 * the economic calendar and the one shared AI overview. Leave it empty and a
 * visitor with no keys has no price source at all: the desk says so and offers
 * the optional Alpaca upgrade. Nothing here is secret — it is just a public
 * URL — so this file is committed and published.
 */
window.DESK_EDGE_API = "https://tickspy-api.sdmtchebe.workers.dev";
// Netlify proxies only the public API; Alpaca credentials never use this path.
if (location.hostname === "tickspy.com" || location.hostname === "www.tickspy.com" || location.hostname.endsWith(".netlify.app") || location.hostname.endsWith(".netlify.com")) {
  window.DESK_EDGE_API = location.origin + "/edge";
}
