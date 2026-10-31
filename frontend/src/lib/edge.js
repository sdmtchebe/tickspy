/*
 * The public address of the TickSPY edge API.
 *
 * The community wall needs the Worker, and it used to carry its own copy of
 * this URL. One constant means a self-hosted deployment
 * only has to set one environment variable, and a URL change cannot leave one
 * feature pointing at the old Worker.
 *
 * This is a public address, not a secret. The Worker's secrets live in
 * Cloudflare and are never part of the frontend bundle.
 */
export const EDGE_API = (
  process.env.REACT_APP_EDGE_API ||
  process.env.REACT_APP_COMMENTS_API ||
  "https://tickspy-api.sdmtchebe.workers.dev"
).replace(/\/+$/, "");
