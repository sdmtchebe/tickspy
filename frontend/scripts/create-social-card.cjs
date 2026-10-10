// Render a deterministic share image using the installed browser, without fonts
// or assets from third parties. PLAYWRIGHT_MODULE may point to a local install.
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#10141c;color:#eef1f6;font-family:Arial,sans-serif;padding:72px}small{color:#6dffcb;font-size:24px;letter-spacing:5px}h1{font-size:82px;letter-spacing:-4px;line-height:1.05;margin:46px 0 24px}h1 span{color:#6dffcb}p{font-size:26px;color:#aeb7c6;line-height:1.5}.foot{border-top:1px solid #374151;margin-top:48px;padding-top:22px;font-size:20px;color:#aeb7c6}</style></head><body><small>TICKSPY</small><h1>Every number,<br><span>explained.</span></h1><p>Charts. Patterns. Volatility. Context.<br>A free market analysis desk.</p><div class="foot">tickspy.com &nbsp; · &nbsp; Research tools, not investment advice.</div></body></html>`);
  await page.screenshot({ path: path.resolve(__dirname, "../public/social-card.png") });
  await browser.close();
  console.log("Created public/social-card.png (1200 × 630).");
})().catch((err) => { console.error(err); process.exit(1); });
