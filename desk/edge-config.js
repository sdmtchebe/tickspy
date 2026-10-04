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
 * Leave it as the empty string and the desk still works: it falls back to the
 * per-symbol news + summary that you unlock with your own keys in Settings, and
 * to the calendar baked into the site at build time. Nothing here is secret —
 * this is just a public URL — so this file is committed and published.
 */
window.DESK_EDGE_API = "";
