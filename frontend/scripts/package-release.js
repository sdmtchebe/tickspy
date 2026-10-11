// Package built assets, never the repo, backend, .env, or API keys.
const fs = require("fs");
const path = require("path");
const from = path.resolve(__dirname, "../build");
const desktop = path.resolve(__dirname, "../../..");
const out = path.join(desktop, "TickSPY-Netlify-Release");
if (fs.existsSync(out) && !process.argv.includes('--replace')) throw new Error(`Release folder already exists: ${out}. Use --replace to archive it before packaging again.`);
for (const name of ["index.html", "_headers", "_redirects", "desk/index.html", "desk/hfdata/SPY.json", "desk/structure-engine.js", "desk/structure-view.js", "desk/structure-chart.js", "desk/structure.css", "terms.html", "privacy.html", "social-card.png"]) {
  if (!fs.existsSync(path.join(from, name))) throw new Error(`Missing release asset: ${name}`);
}
if (fs.existsSync(out)) {
  const backup = `${out}-backup-${Date.now()}`;
  fs.renameSync(out, backup);
  console.log(`Previous release preserved at: ${backup}`);
}
fs.cpSync(from, out, { recursive: true, filter: (file) => !file.endsWith(".map") && path.basename(file) !== ".DS_Store" });
fs.copyFileSync(path.resolve(__dirname,"../../LAUNCH-REPORT.md"), path.join(desktop,"TickSPY-Launch-Report.md"));
console.log(`Netlify upload folder: ${out}`);
