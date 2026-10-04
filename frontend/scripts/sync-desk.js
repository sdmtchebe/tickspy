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

const SRC = path.join(__dirname, "..", "..", "desk", "index.html");
const OUT_DIR = path.join(__dirname, "..", "public", "desk");
const OUT = path.join(OUT_DIR, "index.html");

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[sync-desk] source not found: ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(SRC, OUT);
  console.log(`[sync-desk] bundled desk -> ${path.relative(process.cwd(), OUT)}`);
}

main();
