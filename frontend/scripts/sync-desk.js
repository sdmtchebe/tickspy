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
const FILES = ["index.html", "volmodel.js", "volmodel2.js", "volworker.js", "freesrc.js", "edge-config.js"];
const HFDATA_DIR = path.join(SRC_DIR, "hfdata");

// desk/index.html loads local-config.js unconditionally, because that is how a
// local checkout supplies keys and an API base. That file is git-ignored and
// must never be published — the Pages workflow fails the build outright if it
// finds one — so the reference is removed from the published copy rather than
// the file being satisfied. The desk already treats the variables as optional,
// so the published page behaves exactly as it does locally with no config file.
const LOCAL_TAG = /[ \t]*<script src="local-config\.js"><\/script>[ \t]*\r?\n?/;

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const name of FILES) {
    const from = path.join(SRC_DIR, name);
    if (!fs.existsSync(from)) {
      console.error(`[sync-desk] source not found: ${from}`);
      process.exit(1);
    }

    if (name !== "index.html") {
      fs.copyFileSync(from, path.join(OUT_DIR, name));
      continue;
    }

    const html = fs.readFileSync(from, "utf8");
    const stripped = html.replace(LOCAL_TAG, "");
    if (stripped === html) {
      // Either the tag was renamed or the desk stopped loading the file. Both
      // mean this script is no longer doing its job, so stop rather than publish
      // a page that requests a file we never ship.
      console.error(
        "[sync-desk] desk/index.html does not reference local-config.js the way this script expects.\n" +
          "           Update LOCAL_TAG in this file (and the intent behind it) before publishing."
      );
      process.exit(1);
    }
    fs.writeFileSync(path.join(OUT_DIR, name), stripped);
  }

  // A build before this change may have left one here, and the Pages workflow
  // fails if the published desk ever contains this file. Remove it explicitly.
  const stray = path.join(OUT_DIR, "local-config.js");
  if (fs.existsSync(stray)) {
    fs.unlinkSync(stray);
    console.log("[sync-desk] removed a stray local-config.js from the published desk");
  }

  console.log(`[sync-desk] bundled desk -> ${path.relative(process.cwd(), OUT_DIR)} (${FILES.join(", ")}, local-config tag stripped)`);

  // Copy HF Data Library price data (desk/hfdata/*.json) if present
  if (fs.existsSync(HFDATA_DIR)) {
    const outHfdata = path.join(OUT_DIR, "hfdata");
    fs.mkdirSync(outHfdata, { recursive: true });
    const hfFiles = fs.readdirSync(HFDATA_DIR).filter(f => f.endsWith('.json'));
    for (const name of hfFiles) {
      fs.copyFileSync(path.join(HFDATA_DIR, name), path.join(outHfdata, name));
    }
    console.log(`[sync-desk] bundled HF data -> ${path.relative(process.cwd(), outHfdata)} (${hfFiles.length} files)`);
  } else {
    console.log("[sync-desk] no HF data directory found at ../desk/hfdata (will be created by scheduled function)");
  }
}

main();
