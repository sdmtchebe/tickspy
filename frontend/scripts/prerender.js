// Bakes the rendered landing page into build/index.html.
//
// Why this exists: the site is a client-rendered React app. Googlebot and the
// AdSense reviewer fetch HTML and do not execute the bundle, so the shipped
// index.html was a 156-character <noscript> around an empty #root. To a crawler
// the homepage was a blank page, which is what "Low value content" describes.
//
// This renders the real page once, at build time, and writes the resulting DOM
// back over build/index.html. src/index.js hydrates that markup instead of
// throwing it away, so visitors get the first paint without a blank flash.
//
// It is deliberately allowed to fail the build: a failed Netlify build leaves
// the previous deploy live, and shipping an uncrawlable homepage silently is
// the failure mode we are trying to end.

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer");

const build = path.resolve(__dirname, "../build");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function staticServer(dir) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.join(dir, urlPath);
    if (!file.startsWith(dir)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (urlPath.endsWith("/")) file = path.join(file, "index.html");
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }).end(body);
    });
  });
}

async function main() {
  if (!fs.existsSync(path.join(build, "index.html"))) {
    throw new Error("build/index.html is missing; run `npm run build` first.");
  }

  const server = staticServer(build);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.warn(`[prerender] page error: ${err.message}`));

    // The demo charts and counters tick on setInterval, so without this the
    // dumped markup depends on how long the page happened to be open and the
    // demo numbers change every build. Freezing timers keeps the output
    // reproducible, so a diff between two builds shows real changes only.
    await page.evaluateOnNewDocument(() => {
      window.setInterval = () => 0;
      // The community wall must not fetch comments during the build: a static
      // snapshot should not contain somebody else's conversation, and the
      // build must not depend on the API being reachable. The component checks
      // this flag and renders its honest loading state instead.
      window.__TICKSPY_PRERENDER__ = true;
    });

    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // The hero heading is the first thing React paints. Waiting for it means we
    // dump content, not a loading shell.
    await page.waitForSelector("#main-content h1", { timeout: 45_000 });

    // Let fonts, the chart demo and the reveal animations settle so the dumped
    // markup is the finished page rather than a half-styled interim.
    try {
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 15_000 });
    } catch {
      console.warn("[prerender] network never went idle; continuing with what rendered.");
    }
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400)))),
    );

    const html = await page.evaluate(() => `<!doctype html>\n${document.documentElement.outerHTML}`);
    const cleaned = html.replaceAll(origin, "");

    if (!cleaned.includes('id="main-content"') || cleaned.length < 20_000) {
      throw new Error("prerendered HTML looks empty; refusing to overwrite the build.");
    }

    fs.writeFileSync(path.join(build, "index.html"), cleaned);
    console.log(`[prerender] wrote ${(cleaned.length / 1024).toFixed(1)} KB of crawlable HTML to build/index.html`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

/* Vercel's build image ships no browser and none of the shared libraries one
 * needs (libnspr4 and friends are missing), so Puppeteer's downloaded Chrome
 * cannot start there. @sparticuz/chromium carries its own libraries, extracts
 * them to /tmp with no root access, and needs no system packages — the same
 * trick serverless functions use — so the crawlable snapshot gets made on
 * every host. The regular browser stays first choice everywhere it works
 * (Netlify, GitHub Actions, local macOS); this is only the fallback after that
 * launch fails on Linux. */
async function launchBrowser() {
  // Netlify's build container runs as an unprivileged user without a
  // sandbox namespace, so the sandbox has to come off there.
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  try {
    return await puppeteer.launch({ args });
  } catch (err) {
    if (process.platform !== "linux") throw err;
    console.warn(
      `[prerender] the regular browser failed to start (${String(err.message).split("\n")[0]}); retrying with the bundled serverless Chromium.`,
    );
    const mod = require("@sparticuz/chromium");
    const chromium = mod.default || mod;
    return await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      headless: "shell",
      args: [...args, "--disable-gpu", "--font-render-hinting=none"],
    });
  }
}

main().catch((err) => {
  console.error(`[prerender] FAILED: ${err.message}`);
  console.error("[prerender] The homepage would ship without crawlable content. Fix this before deploying.");
  process.exit(1);
});
