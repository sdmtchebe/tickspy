// Package built assets, never the repo, backend, .env, or API keys.
const fs = require("fs");
const path = require("path");
const from = path.resolve(__dirname, "../build");
const desktop = path.resolve(__dirname, "../../..");
const out = path.join(desktop, "TickSPY-Netlify-Release");
if (fs.existsSync(out)) throw new Error(`Release folder already exists: ${out}. Move it aside before packaging again.`);
for (const name of ["index.html", "_headers", "_redirects", "desk/index.html", "terms.html", "privacy.html", "social-card.png"]) {
  if (!fs.existsSync(path.join(from, name))) throw new Error(`Missing release asset: ${name}`);
}
fs.cpSync(from, out, { recursive: true, filter: (file) => !file.endsWith(".map") && path.basename(file) !== ".DS_Store" });
fs.copyFileSync(path.resolve(__dirname,"../../LAUNCH-REPORT.md"), path.join(desktop,"TickSPY-Launch-Report.md"));
console.log(`Netlify upload folder: ${out}`);
