// Security headers travel with both repository builds and manual deploys.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const build = path.resolve(__dirname, "../build");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const entries = files(build);
for (const file of entries) {
  if (path.basename(file) === ".DS_Store" || file.endsWith(".map")) fs.unlinkSync(file);
  if (/local-config|(?:^|\/)\.env(?:\.|$)|\.pem$|\.key$/i.test(file)) throw new Error(`Private configuration must never be published: ${file}`);
}
const hashes = new Set();
for (const file of entries.filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(file, "utf8");
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*local-config\.js/i.test(html)) throw new Error("A page still loads private configuration.");
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1]) && match[2].trim()) hashes.add(`'sha256-${crypto.createHash("sha256").update(match[2]).digest("base64")}'`);
  }
}
const scripts = ["'self'", ...hashes, "https://cdn.jsdelivr.net"];
const connects = ["'self'", "https://formsubmit.co", "https://data.alpaca.markets", "wss://stream.data.alpaca.markets", "https://tickspy-api.sdmtchebe.workers.dev", "https://cdn.jsdelivr.net", "https://nfs.faireconomy.media"];
const frames = ["'none'"], images = ["'self'", "data:", "blob:"];
if (process.env.REACT_APP_ENABLE_ADS === "true") {
  const ads = ["https://*.googlesyndication.com", "https://*.doubleclick.net", "https://*.google.com", "https://*.googleadservices.com"];
  scripts.push(...ads); connects.push(...ads); images.push(...ads); frames.splice(0, 1, ...ads);
}
const csp = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
  `script-src ${scripts.join(" ")}`, "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
  `img-src ${images.join(" ")}`, `connect-src ${connects.join(" ")}`, "worker-src 'self' blob:",
  `frame-src ${frames.join(" ")}`, "form-action 'self' https://formsubmit.co", "upgrade-insecure-requests",
].join("; ");
// TensorFlow's CPU kernels compile code dynamically. Permit that only in its
// isolated worker, which cannot access browser localStorage or the page DOM.
// Explicit HTML paths prevent overlapping CSP headers from weakening pages.
let policies = "";
for (const file of entries.filter((f) => f.endsWith(".html"))) {
  const url = "/" + path.relative(build, file).split(path.sep).join("/");
  policies += `${url}\n  Content-Security-Policy: ${csp}\n`;
  if (url.endsWith("/index.html")) policies += `${url.slice(0, -10)}\n  Content-Security-Policy: ${csp}\n`;
}
const workerCsp = "default-src 'none'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net";
policies += `/desk/volworker.js\n  Content-Security-Policy: ${workerCsp}\n`;
fs.writeFileSync(path.join(build, "_headers"), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()
  Strict-Transport-Security: max-age=31536000
  Cache-Control: public, max-age=0, must-revalidate
/static/*
  Cache-Control: public, max-age=31536000, immutable
` + policies);
console.log(`[finalize-build] hashed ${hashes.size} inline scripts; emitted Netlify security headers; removed source maps and OS noise.`);
