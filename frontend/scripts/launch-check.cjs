// Production-artifact checks in real Chrome. Native route fulfillment emulates
// Netlify headers and its public API proxy, including the tickspy.com origin.
// Email submission and race checks use fixtures; no messages are actually sent.
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const build = path.resolve(__dirname, "../build");
const reports = path.resolve(__dirname, "../../test_reports");
const csp = fs.readFileSync(path.join(build, "_headers"), "utf8").match(/Content-Security-Policy: (.+)/)[1];
const workerCsp = fs.readFileSync(path.join(build, "_headers"), "utf8").match(/\/desk\/volworker\.js\n  Content-Security-Policy: (.+)/)[1];
const cache = new Map();
const results = [];
function check(name, value) { assert(value, name); results.push(name); console.log(`PASS ${name}`); }
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
async function upstream(api) {
  if (!cache.has(api)) cache.set(api, (async () => {
    const response = await fetch(`https://tickspy-api.sdmtchebe.workers.dev${api}`, { signal: AbortSignal.timeout(30000) });
    return { status: response.status, body: await response.text() };
  })());
  return cache.get(api);
}
async function routes(context, prefix = "", fixture = false) {
  await context.route(/https:\/\/(tickspy\.com|sdmtchebe\.github\.io|tickspy-launch\.netlify\.app)\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/edge/api/")) {
      const api = url.pathname.slice(5) + url.search;
      const data = await upstream(api);
      if (fixture && url.searchParams.get("symbol") === "AAPL") await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({ ...data, contentType: "application/json" });
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (prefix && pathname.startsWith(prefix)) pathname = pathname.slice(prefix.length);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.resolve(build, `.${pathname}`);
    if (!file.startsWith(build + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      await route.fulfill({ status: 404, contentType: "text/html", body: fs.readFileSync(path.join(build, "404.html")) }); return;
    }
    await route.fulfill({ status: 200, headers: { "Content-Security-Policy": pathname.endsWith("/volworker.js") ? workerCsp : csp, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" }, contentType: mime[path.extname(file)] || "text/plain", body: fs.readFileSync(file) });
  });
}
async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await routes(context);
    const page = await context.newPage(), errors = [], violations = [], adRequests = [];
    context.on("page", (p) => {
      p.on("pageerror", (error) => errors.push(error.message));
      p.on("console", (message) => { if (/Content Security Policy|violates.*directive|Refused to/i.test(message.text())) violations.push(message.text()); });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (/Content Security Policy|violates.*directive|Refused to/i.test(message.text())) violations.push(message.text()); });
    context.on("request", (request) => { if (/googlesyndication|doubleclick|googleadservices/.test(request.url())) adRequests.push(request.url()); });
    await page.goto("https://tickspy.com/", { waitUntil: "networkidle" });
    check("Landing page loads under the enforced release CSP", await page.getByTestId("hero-headline").isVisible());
    check("tickspy.com is the canonical URL", await page.locator('link[rel="canonical"]').getAttribute("href") === "https://tickspy.com/");
    check("Support address is configured", await page.evaluate(() => window.DESK_SUPPORT_EMAIL) === "tickspysupport@gmail.com");
    check("Advertising is disabled and no consent banner obscures content", await page.getByTestId("cookie-consent").count() === 0 && adRequests.length === 0);
    const original = page.url();
    const popup = context.waitForEvent("page");
    await page.getByTestId("nav-open-app-button").click();
    const desk = await popup;
    await desk.waitForLoadState("domcontentloaded");
    await desk.waitForSelector("#gate-ok");
    await desk.locator("#gate-ok").click();
    await desk.waitForFunction(() => document.getElementById("px").textContent.startsWith("$"), null, { timeout: 45000 });
    check("Open desk creates exactly one tab and keeps the landing page", context.pages().length === 2 && page.url() === original);
    check("New desk has no opener", await desk.evaluate(() => window.opener === null));
    check("Netlify custom-domain mode uses the same-origin proxy", await desk.evaluate(() => window.DESK_EDGE_API) === "https://tickspy.com/edge");
    check("Live public API supplies the completed-session replay", (await desk.locator("#fbn").textContent()).includes("not a current quote"));
    check("The desk has 9 working navigation sections", await desk.locator("#nav button").count() === 9);
    check("The desk computes the advertised 14 indicators", await desk.evaluate(() => S.an.it.length === 14));
    check("Feed links reject script URLs and HTML is escaped", await desk.evaluate(() => safeUrl('javascript:alert(1)') === '' && esc('<img src=x onerror=alert(1)>').startsWith('&lt;')));
    for (const id of ["ind", "pat", "news", "cal", "alert", "tools", "set", "live"]) {
      await desk.locator(`#nav button[data-k="${id}"]`).click();
      check(`Desk section ${id} opens`, await desk.locator(`#t-${id}`).isVisible());
    }
    await desk.waitForFunction(() => document.querySelectorAll("#ml .item").length > 0, null, { timeout: 30000 });
    check("News renders through the public proxy", await desk.locator("#ml .item").count() > 0);
    await desk.waitForFunction(() => document.getElementById("ovw").textContent.length > 100, null, { timeout: 30000 });
    check("AI overview renders as text", !(await desk.locator("#ovw").textContent()).includes("unavailable"));
    check("Calendar loads", await desk.evaluate(() => S.cal?.length > 0));
    await desk.locator('#nav button[data-k="tools"]').click();
    for (const [id, value] of [["ra", "25000"], ["rr", "0.5"], ["re", "100"], ["stop", "98"]]) await desk.locator(`#${id}`).fill(value);
    check("Risk arithmetic yields 62 shares for $125 at $2 per-share risk", (await desk.locator("#ro").textContent()).startsWith("62 shares"));
    await desk.locator("#rr").fill("-1");
    check("Risk calculator rejects negative inputs", (await desk.locator("#ro").textContent()).includes("positive account"));
    await desk.locator('#nav button[data-k="alert"]').click();
    await desk.locator("#av").fill("1"); await desk.locator("#aadd").click();
    await desk.evaluate(() => { S.sym = "NVDA"; alerCheck(); });
    check("SPY alert survives a price check on a different ticker", await desk.evaluate(() => JSON.parse(localStorage.alerts).some((a) => a.sym === "SPY")));
    await desk.evaluate(() => { S.sym = "SPY"; alerCheck(); });
    check("The alert fires only on its own ticker", await desk.evaluate(() => JSON.parse(localStorage.alerts).length === 0));
    await desk.locator('#nav button[data-k="set"]').click();
    await desk.locator("#ak").fill("PK_TEST_ONLY"); await desk.locator("#sv").click();
    check("Partial API keys are rejected without storing credentials", await desk.evaluate(() => !JSON.parse(localStorage.cfg || "{}").ak));
    await desk.locator("#legal-open").click();
    await desk.locator("#gate-close").focus(); await desk.keyboard.press("Tab");
    check("Legal dialog traps keyboard focus", await desk.evaluate(() => document.activeElement.closest("#gate") !== null));
    await desk.keyboard.press("Escape");
    check("Disclosure dialog closes with Escape", !(await desk.locator("#gate").isVisible()));
    await desk.locator('#nav button[data-k="vol"]').click();
    await desk.waitForFunction(() => document.getElementById("vout").textContent.includes("per bar") || document.getElementById("vout").textContent.includes("unavailable"), null, { timeout: 180000 });
    check("Volatility Web Worker completes under CSP", (await desk.locator("#vout").textContent()).includes("per bar"));
    await desk.locator('#nav button[data-k="live"]').click();
    await desk.screenshot({ path: path.join(reports, "launch-desk-desktop.png"), fullPage: true });
    await page.getByTestId("demo-tab-news").scrollIntoViewIfNeeded();
    await page.getByTestId("demo-tab-news").click(); await page.keyboard.press("ArrowRight");
    check("Demo tabs support keyboard arrow navigation", await page.getByTestId("demo-tab-volatility").getAttribute("aria-selected") === "true");
    let sent = 0;
    await context.route("https://formsubmit.co/ajax/**", async (route) => { sent++; await route.fulfill({ contentType: "application/json", body: '{"success":true}' }); });
    await page.getByTestId("contact-name-input").fill("Launch fixture");
    await page.getByTestId("contact-email-input").fill("fixture@example.com");
    await page.getByTestId("contact-message-input").fill("Browser verification only; not sent to the real inbox.");
    await page.getByTestId("contact-form-submit").click();
    await page.waitForFunction(() => document.getElementById("c-msg").value === "");
    check("Contact form handles a confirmed relay response", sent === 1);
    await context.route("https://formsubmit.co/ajax/**", (route) => route.fulfill({ contentType: "application/json", body: '{"message":"Not confirmed"}' }));
    await page.getByTestId("contact-name-input").fill("Launch fixture");
    await page.getByTestId("contact-email-input").fill("fixture@example.com");
    await page.getByTestId("contact-message-input").fill("Retain this draft on an unconfirmed response.");
    await page.getByTestId("contact-form-submit").click(); await page.waitForTimeout(500);
    check("An unconfirmed relay response preserves the message", await page.getByTestId("contact-message-input").inputValue() === "Retain this draft on an unconfirmed response.");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(reports, "launch-landing-desktop.png") });
    for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(size); await desk.setViewportSize(size);
      await page.waitForTimeout(300);
      check(`Landing fits ${size.width}×${size.height}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      check(`Desk fits ${size.width}×${size.height}`, await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (size.width === 375) {
        await page.screenshot({ path: path.join(reports, "launch-landing-mobile.png") });
        await desk.screenshot({ path: path.join(reports, "launch-desk-mobile.png"), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId("nav-menu-toggle").click(); await page.getByTestId("nav-mobile-link-contact").click();
    check("Mobile menu navigates and dismisses", await page.getByTestId("nav-menu-toggle").getAttribute("aria-expanded") === "false");
    for (const file of ["privacy.html", "terms.html", "privacy-fr.html", "terms-fr.html"]) {
      await page.goto(`https://tickspy.com/${file}`); check(`${file} is available`, await page.locator("h1").isVisible());
    }
    if(errors.length || violations.length) console.log(JSON.stringify({errors,violations},null,2));
    check("No JavaScript runtime errors", errors.length === 0);
    check("No Content Security Policy violations", violations.length === 0);
    check("No advertising requests during the entire session", adRequests.length === 0);
    await context.close();

    const sub = await browser.newContext({ reducedMotion: "reduce" }); await routes(sub, "/tickspy");
    const subPage = await sub.newPage(); await subPage.goto("https://sdmtchebe.github.io/tickspy/");
    check("GitHub Pages subpath keeps the native desk link correct", await subPage.getByTestId("nav-open-app-button").evaluate((el) => el.href) === "https://sdmtchebe.github.io/tickspy/desk/index.html");
    await sub.close();
    const live = await browser.newContext(); await routes(live);
    await live.addInitScript(() => { localStorage.cfg = JSON.stringify({ak:'PK_LAUNCH_FIXTURE',as:'LAUNCH_FIXTURE_NOT_A_REAL_SECRET'}); localStorage.legal = 'fixture'; });
    const fixtureBars = Array.from({length:90},(_,i)=>({t:new Date(Date.UTC(2026,9,9,13,30+i)).toISOString(),o:100+i*.1,h:101+i*.1,l:99+i*.1,c:100.5+i*.1,v:1000}));
    await live.route('https://data.alpaca.markets/**', (route) => {
      const url = new URL(route.request().url());
      const series=url.pathname.includes('/QQQ/')?fixtureBars.map((b,i)=>({...b,c:200+i*2})):fixtureBars;
      const body = url.pathname.includes('news') ? {news:[]} : url.searchParams.has('symbols') ? {bars:{SPY:fixtureBars.slice(-3).reverse()}} : {bars:series.slice().reverse()};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await live.routeWebSocket('wss://stream.data.alpaca.markets/**', (socket) => { socket.onMessage(() => {}); });
    const livePage = await live.newPage(); await livePage.goto('https://tickspy.com/desk/');
    await livePage.waitForFunction(() => document.getElementById('px').textContent.startsWith('$'));
    check('Alpaca mode shows the historical close before any streamed trade arrives', await livePage.locator('#px').textContent() === '$109.40');
    await livePage.waitForFunction(()=>S.rs&&S.rs.s!==undefined);
    check('Live-mode relative strength uses chronological returns, not their inverse', await livePage.evaluate(() => S.rs.s>0&&S.rs.q>0&&S.rs.d<0));
    check('The EMA backtester flips at every opposite crossover', await livePage.evaluate(() => {
      const saved=S.bars;
      const c=Array.from({length:120},(_,i)=>100+Math.sin(i*Math.PI/12)*10);
      S.bars=c.map((close,i)=>({t:new Date(1700000000000+i*60000),o:close,h:close+1,l:close-1,c:close,v:1000}));
      const a=ema(c,9),b=ema(c,21),crosses=c.slice(1).filter((_,i)=>(a[i+1]>b[i+1])!==(a[i]>b[i])).length;
      const result=backtest();S.bars=saved;return result.n===crosses;
    }));
    await live.close();
    const bad = await browser.newContext(); await routes(bad, "", true);
    await bad.addInitScript(() => { localStorage.cfg = "broken"; localStorage.alerts = "null"; localStorage.wl = "{}"; localStorage.legal = "fixture"; });
    const badPage = await bad.newPage(); const badErrors = []; badPage.on("pageerror", (e) => badErrors.push(e.message));
    await badPage.goto("https://tickspy.com/desk/");
    await badPage.waitForFunction(() => document.getElementById("px").textContent.startsWith("$"), null, { timeout: 45000 });
    check("Malformed saved preferences recover without blanking the desk", badErrors.length === 0);
    await badPage.evaluate(() => { S.sym = "AAPL"; load(); S.sym = "NVDA"; load(); });
    await badPage.waitForTimeout(2000);
    check("Late responses cannot overwrite the newly selected ticker", await badPage.evaluate(() => S.sym === "NVDA" && S.free?.symbol === "NVDA"));
    await bad.close();
    const disabled = await browser.newContext(); await routes(disabled);
    await disabled.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage disabled", "SecurityError"); } }));
    const disabledPage = await disabled.newPage(); const storageErrors = []; disabledPage.on("pageerror", (e) => storageErrors.push(e.message));
    await disabledPage.goto("https://tickspy.com/desk/"); await disabledPage.locator("#gate-ok").click();
    await disabledPage.waitForFunction(() => document.getElementById("px").textContent.startsWith("$"), null, { timeout: 45000 });
    check("Disabled browser storage still permits session-only use", storageErrors.length === 0);
    await disabled.close();
    fs.writeFileSync(path.join(reports, "launch-browser-results.json"), JSON.stringify({ passed: results.length, results }, null, 2));
    console.log(`\n${results.length} browser launch checks passed.`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
