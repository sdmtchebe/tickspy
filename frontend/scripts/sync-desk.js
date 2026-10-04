/*
 * Publishes the trading desk (../../desk) into public/desk so the marketing
 * site can serve it at /desk/index.html.
 *
 * The desk keeps a single source of truth: ../../desk/index.html. This script
 * runs automatically before `yarn start` and `yarn build` (see package.json
 * prestart/prebuild), so the bundled copy never drifts. public/desk is
 * generated and git-ignored.
 */
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "..", "desk");
const OUT_DIR = path.join(__dirname, "..", "public", "desk");
// Only the static assets the page actually loads. Secrets (local-config.js) are
// deliberately never copied. edge-config.js holds only a public Worker URL, so
// it is safe to publish.
const FILES = ["index.html", "volmodel.js", "volmodel2.js", "edge-config.js"];

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of FILES) {
    const from = path.join(SRC_DIR, name);
    if (!fs.existsSync(from)) {
      console.error(`[sync-desk] source not found: ${from}`);
      process.exit(1);
    }
    fs.copyFileSync(from, path.join(OUT_DIR, name));
  }
  console.log(`[sync-desk] bundled desk -> ${path.relative(process.cwd(), OUT_DIR)} (${FILES.join(", ")})`);
}

main();
