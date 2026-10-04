/*
 * Backtest the desk's own confidence labels, by running the real code.
 *
 *   node desk/tests/score_backtest.js [bars.json]
 *
 * This does NOT re-implement the scoring. It loads desk/index.html in Chrome,
 * then calls the page's own global analyze() once per bar over real history and
 * reads back the numbers the UI shows: `up` (the 0-100 score behind the
 * Bullish/Bearish/Mixed call) and `big` (the 0-3 count behind "Chance of a big
 * move"). Forward outcomes are measured on bars the scorer never saw.
 *
 * Two questions:
 *   1. Does a high score actually precede a positive move? If "Bullish" (>=60)
 *      is followed by the same returns as "Bearish" (<=40), the label lies.
 *   2. Does "High" big-move chance actually mean a bigger move than "Low"? The
 *      word "Chance" promises a probability; if the levels are not ordered,
 *      the wording is the problem, not the maths.
 *
 * Limitations stated up front: one instrument (SPY), 5-minute bars, a trailing
 * 400-bar window per evaluation (the desk loads 500), stride 10 so the sample
 * is not independent, no costs, and no attempt to model the multi-timeframe or
 * pattern overlays beyond what analyze() itself reads.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("/tmp/tfjstest/node_modules/puppeteer-core");

const DESK = path.join(__dirname, "..");
const PORT = Number(process.env.SB_PORT || 8791);
const STRIDE = Number(process.env.SB_STRIDE || 20);
const WIN = Number(process.env.SB_WIN || 300);
const BARS = process.argv[2] || "/tmp/bt_SPY_5Min.json";
const FWD = 12; // forward horizon in bars

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  let p = path.join(DESK, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DESK, "index.html");
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(buf);
  });
});

const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
const f = (x, d = 2) => (x == null || !isFinite(x) ? "--" : Number(x).toFixed(d));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

(async () => {
  const raw = JSON.parse(fs.readFileSync(BARS, "utf8"));
  const bars = (raw.bars || raw).map((b) => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }));
  console.log(`${bars.length} bars  ${bars[0].t.slice(0, 10)} .. ${bars[bars.length - 1].t.slice(0, 10)}  stride ${STRIDE}, window ${WIN}`);

  await new Promise((r) => server.listen(PORT, r));
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio"],
    // The whole sweep runs in one page.evaluate; analyze() is heavy, so the
    // default 180s protocol timeout is not enough on a long sample.
    protocolTimeout: 1800000,
  });
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The desk boots regardless of keys; we only need its scoring functions live.
  await page.waitForFunction(() => typeof analyze === "function" && typeof S === "object", { timeout: 30000 });

  // The whole sweep runs inside the page so there is no per-bar round trip.
  const rows = await page.evaluate(
    async (args) => {
      const { bars, stride, win, fwd } = args;
      const B = bars.map((b) => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
      const out = [];
      const orig = S.bars;
      for (let i = win; i < B.length - fwd - 1; i += stride) {
        S.bars = B.slice(i - win, i);
        let an = null;
        try { analyze(); an = S.an; } catch (e) { an = null; }
        if (!an || !isFinite(an.up) || !isFinite(an.big)) continue;
        const now = B[i - 1];
        // Forward outcomes use bars the scorer never saw.
        const fwdRet = B[i + fwd - 1].c / now.c - 1;
        let hi = -Infinity, lo = Infinity;
        for (let k = i; k < i + fwd; k++) { hi = Math.max(hi, B[k].h); lo = Math.min(lo, B[k].l); }
        out.push({
          up: an.up,
          big: an.big,
          atrPct: (an.atr / an.p) * 100,
          // next-bar return, to check the directional call at its own horizon
          r1: B[i].c / now.c - 1,
          rf: fwdRet,
          range: (hi - lo) / now.c,
        });
      }
      S.bars = orig;
      return out;
    },
    { bars, stride: STRIDE, win: WIN, fwd: FWD }
  );

  await browser.close();
  server.close();

  const n = rows.length;
  console.log(`evaluated ${n} bars\n`);
  if (!n) { console.log("no evaluations — scorer never produced a reading"); process.exit(1); }

  // ---------------------------------------------------------- 1. the score --
  console.log("1) the 0-100 score, against the forward move it is implicitly calling");
  console.log("   bucket      n     mean fwd ret    % up     mean |fwd|");
  const buckets = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];
  for (const [lo, hi] of buckets) {
    const r = rows.filter((x) => x.up >= lo && x.up < hi);
    if (!r.length) continue;
    console.log(
      `   ${String(lo).padStart(3)}-${String(hi === 101 ? 100 : hi - 1).padStart(3)}  ${String(r.length).padStart(6)}   ` +
        `${(mean(r.map((x) => x.rf)) * 100 >= 0 ? "+" : "")}${f(mean(r.map((x) => x.rf)) * 100, 3)}%   ` +
        `${f((r.filter((x) => x.rf > 0).length / r.length) * 100, 1).padStart(5)}%   ${f(mean(r.map((x) => Math.abs(x.rf))) * 100, 3)}%`
    );
  }
  const bull = rows.filter((x) => x.up >= 60);
  const bear = rows.filter((x) => x.up <= 40);
  const all = rows;
  const wr = (r) => (r.length ? (r.filter((x) => x.rf > 0).length / r.length) * 100 : NaN);
  console.log(`\n   "Bullish" (score>=60): n=${bull.length}  mean fwd ${f(mean(bull.map((x) => x.rf)) * 100, 3)}%  up-rate ${f(wr(bull), 1)}%`);
  console.log(`   "Bearish" (score<=40): n=${bear.length}  mean fwd ${f(mean(bear.map((x) => x.rf)) * 100, 3)}%  up-rate ${f(wr(bear), 1)}%`);
  console.log(`   all bars             : n=${all.length}  mean fwd ${f(mean(all.map((x) => x.rf)) * 100, 3)}%  up-rate ${f(wr(all), 1)}%`);
  const spread = mean(bull.map((x) => x.rf)) - mean(bear.map((x) => x.rf));
  console.log(`   spread (Bullish minus Bearish) = ${spread * 100 >= 0 ? "+" : ""}${f(spread * 100, 3)}% per ${FWD} bars`);

  // ------------------------------------------------- 2. the big-move label --
  const absR = rows.map((x) => Math.abs(x.rf));
  const cutoff = q(absR, 2 / 3);
  console.log(`\n2) "Chance of a big move", against an actual big move (top third of |${FWD}-bar moves|, > ${f(cutoff * 100, 3)}%)`);
  const LABEL = ["Low", "Low", "Medium", "High"];
  console.log("   big  label     n     P(big move)    mean |fwd|   mean range");
  for (const lvl of [0, 1, 2, 3]) {
    const r = rows.filter((x) => x.big === lvl);
    if (!r.length) { console.log(`   ${lvl}    ${LABEL[lvl].padEnd(7)} 0`); continue; }
    const hit = r.filter((x) => Math.abs(x.rf) > cutoff).length / r.length;
    console.log(
      `   ${lvl}    ${LABEL[lvl].padEnd(7)} ${String(r.length).padStart(6)}   ${f(hit * 100, 1).padStart(8)}%   ` +
        `${f(mean(r.map((x) => Math.abs(x.rf))) * 100, 3).padStart(9)}%   ${f(mean(r.map((x) => x.range)) * 100, 3)}%`
    );
  }
  const baseRate = rows.filter((x) => Math.abs(x.rf) > cutoff).length / rows.length;
  console.log(`   base rate across all bars = ${f(baseRate * 100, 1)}%`);
  const low = rows.filter((x) => x.big === 0);
  const high = rows.filter((x) => x.big >= 2);
  console.log(
    `   P(big move) Low=${f((low.filter((x) => Math.abs(x.rf) > cutoff).length / (low.length || 1)) * 100, 1)}%  ` +
      `Medium+High=${f((high.filter((x) => Math.abs(x.rf) > cutoff).length / (high.length || 1)) * 100, 1)}%`
  );

  console.log(`\npage errors during the sweep: ${errs.length ? errs.slice(0, 3).join(" | ") : "none"}`);
  fs.writeFileSync("/tmp/score_backtest_rows.json", JSON.stringify({ n, spread, baseRate }));
})().catch((e) => { console.error("HARNESS ERROR:", (e && e.stack) || e); process.exit(2); });
