/*
 * Free-mode engine test for the desk.
 *
 *   node desk/tests/freesrc.js
 *
 * freesrc.js is what makes the desk usable with no Alpaca account, so the parts
 * that can be wrong quietly are the parts worth pinning:
 *
 *   - which of the three modes the desk is in;
 *   - the replay clock, including that it maps the current time-of-day onto the
 *     *previous* session rather than showing the whole day all the time, and
 *     that it is DST-correct on both sides of the year;
 *   - that the reveal can never return an empty chart, which would look like a
 *     broken feed rather than a finished session;
 *   - that nothing can present replayed data as a live quote.
 */
const Free = require(require("path").join(__dirname, "..", "freesrc.js"));

let failed = 0;
function ok(label, cond, extra) {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
}
function eq(label, got, want) {
  ok(label, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* ------------------------------------------------------------------ helpers */

const SESSION = "2026-10-08";
const iso = (at) => new Date(at).toISOString();

function sessionBars(date = SESSION, count = 78) {
  const bars = [];
  let px = 500;
  for (let i = 0; i < count; i++) {
    const o = px;
    const c = px + 0.1;
    bars.push({ t: iso(Free.etInstant(date, 570 + i * 5)), o, h: c + 0.2, l: o - 0.2, c, v: 1000 + i });
    px = c;
  }
  return bars;
}

/* -------------------------------------------------------------------- modes */

console.log("modes");
eq("saved keys mean live mode", Free.modeFor({ ak: "PK123", as: "secret" }, { edgeApi: "https://e" }), "live");
eq("no keys but an edge API means free mode", Free.modeFor({}, { edgeApi: "https://e" }), "free");
eq("no keys and nowhere to fetch means none", Free.modeFor({}, { edgeApi: "" }), "none");
eq("a half-configured key pair still counts as live", Free.modeFor({ as: "secret" }, {}), "live");

/* --------------------------------------------------------------- ET clock */

console.log("\nUS/Eastern clock");
eq("etDate reads the ET calendar day", Free.etDate(Date.parse("2026-10-08T13:30:00Z")), SESSION);
eq("etMinutes reads minutes past midnight ET", Free.etMinutes(Date.parse("2026-10-08T13:30:00Z")), 9 * 60 + 30);
eq("09:30 ET in summer is 13:30Z", iso(Free.etInstant(SESSION, 570)), "2026-10-08T13:30:00.000Z");
eq("09:30 ET in winter is 14:30Z", iso(Free.etInstant("2026-01-15", 570)), "2026-01-15T14:30:00.000Z");
eq("the ET minutes survive a round trip", Free.etMinutes(Free.etInstant(SESSION, 960)), 960);

/* ------------------------------------------------------------------ replay */

console.log("\nreplay clock");
{
  // 11:00 ET on the day after the session, with the session dated 2026-10-08.
  const inside = Free.replayAt(Date.parse("2026-10-09T15:00:00Z"), SESSION);
  eq("inside the session the cutoff tracks the time of day", iso(inside.at), "2026-10-08T15:00:00.000Z");
  eq("and reports the session minute", inside.minutes, 11 * 60);
  ok("and is marked live", inside.live && !inside.complete);

  const after = Free.replayAt(Date.parse("2026-10-09T23:00:00Z"), SESSION); // 19:00 ET, closed
  eq("after the close the whole session is on screen", iso(after.at), "2026-10-08T20:00:00.000Z");
  ok("and is marked complete", after.complete && !after.live);

  const before = Free.replayAt(Date.parse("2026-10-09T12:00:00Z"), SESSION); // 08:00 ET, pre-market
  ok("before the open there is nothing to replay yet", before.complete && !before.live);

  // The same wall-clock time in winter must land on the winter session's clock.
  const winter = Free.replayAt(Date.parse("2026-01-16T16:00:00Z"), "2026-01-15"); // 11:00 ET
  eq("winter replays against the winter session", iso(winter.at), "2026-01-15T16:00:00.000Z");
}

console.log("\nreveal");
{
  const bars = sessionBars();
  const at1100 = Free.replayAt(Date.parse("2026-10-09T15:00:00Z"), SESSION).at;
  const upto = Free.reveal(bars, at1100);
  eq("only bars at or before the cutoff are shown", upto.length, 19); // 09:30..11:00 inclusive
  eq("the first bar is the session open", upto[0].t, "2026-10-08T13:30:00.000Z");
  eq("the last is the cutoff bar", upto[upto.length - 1].t, "2026-10-08T15:00:00.000Z");
  eq("a completed session shows every bar", Free.reveal(bars, Free.replayAt(Date.parse("2026-10-09T23:00:00Z"), SESSION).at).length, 78);
  eq("an empty input is not a crash", Free.reveal([], new Date()).length, 0);
  eq("a cutoff before the open falls back to the full session", Free.reveal(bars, new Date("2020-01-01T00:00:00Z")).length, 78);
  eq("and so does a cutoff inside the first bars", Free.reveal(bars, new Date("2026-10-08T13:35:00Z")).length, 78);
}

console.log("\nlabels");
{
  const rep = Free.replayAt(Date.parse("2026-10-09T15:00:00Z"), SESSION);
  ok("the replay label carries the clock and the session date", /11:00 ET/.test(Free.replayLabel(rep, SESSION)) && /Thu 8 Oct/.test(Free.replayLabel(rep, SESSION)), Free.replayLabel(rep, SESSION));
  const done = Free.replayAt(Date.parse("2026-10-09T23:00:00Z"), SESSION);
  ok("a finished replay says so", /full session/.test(Free.replayLabel(done, SESSION)), Free.replayLabel(done, SESSION));
  eq("dates are formatted without a timezone trap", Free.prettyDate(SESSION), "Thu 8 Oct");
  eq("a malformed date is passed through", Free.prettyDate("n/a"), "n/a");

  const text = Free.labelled({ source: "yahoo", sessionDate: SESSION });
  ok("the disclosure names the session", text.includes("Thu 8 Oct"), text);
  ok("the disclosure says it is not a current quote", /not a current quote/i.test(text), text);
  ok("the disclosure names the source the API actually used", text.includes("Yahoo Finance"), text);
  ok("the fallback source is named too, and capitalised", Free.labelled({ source: "stooq", sessionDate: SESSION }).includes("Stooq"), "stooq label");
  ok("a symbol list answered by both says so", Free.labelled({ source: "mixed", sessionDate: SESSION }).includes("the free sources"), "mixed label");
  ok("an unknown machine name is passed through rather than hidden", Free.labelled({ source: "somefeed", sessionDate: SESSION }).includes("somefeed"), "unknown label");
}

console.log("\nsession clock");
{
  const rep = Free.replayAt(Date.parse("2026-10-09T15:00:00Z"), SESSION);
  const clk = Free.displayClock(rep, Date.parse("2026-10-09T15:00:37Z"), SESSION);
  eq("the replay clock shows the replayed time", `${clk.h}:${String(clk.mi).padStart(2, "0")}`, "11:00");
  eq("but the seconds come from the real clock, so it appears to tick", clk.s, 37);
  eq("and it is dated to the session", clk.date, SESSION);
  const closed = Free.displayClock(Free.replayAt(Date.parse("2026-10-09T23:00:00Z"), SESSION), Date.parse("2026-10-09T23:00:00Z"), SESSION);
  eq("when the session is over the real clock returns", closed.date, "2026-10-09");
  ok("and it is not marked live", !closed.live);
}

/* ----------------------------------------------------------- derived data */

console.log("\nwatchlist and movers");
{
  const q = Free.quotesFromDaily({
    SPY: [{ c: 100, t: "2026-10-07T13:30:00.000Z" }, { c: 102, t: "2026-10-08T13:30:00.000Z" }],
    QQQ: [{ c: 50, t: "2026-10-08T13:30:00.000Z" }],
    EMPTY: [],
  });
  eq("the last close is the price", q.SPY.p, 102);
  eq("the change is against the prior close", Math.round(q.SPY.ch * 100) / 100, 2);
  eq("a single bar is a flat return", q.QQQ.ch, 0);
  ok("an empty series is dropped", q.EMPTY === undefined);

  const list = Free.movers(q, 5);
  eq("movers are ranked by absolute move", list[0].s, "SPY");
  eq("and capped", list.length, 2);
}

console.log("\nsymbol news");
{
  const items = [
    { title: "Apple beats on services revenue", summary: "" },
    { title: "Nvidia and Tesla lead chip rally", summary: "" },
    { title: "Stocks inch up as V-shaped recovery stalls", summary: "" },
    { title: "Nasdaq 100 rebalances next week", summary: "" },
  ];
  eq("a ticker is matched on its own alias", Free.newsForSymbol(items, "AAPL").length, 1);
  eq("aliases match without the ticker", Free.newsForSymbol(items, "NVDA")[0].title, "Nvidia and Tesla lead chip rally");
  eq("an index alias matches", Free.newsForSymbol(items, "QQQ").length, 1);
  eq("a one-letter ticker is matched by name, not by letter", Free.newsForSymbol(items, "V").length, 0);
  eq("so its company name still works", Free.newsForSymbol([{ title: "Visa raises its dividend" }], "V").length, 1);
  eq("and 'V-shaped' is not mistaken for the ticker", Free.symbolTerms("V").join(","), "Visa");
  eq("an unknown ticker matches only itself", Free.newsForSymbol([{ title: "Nothing relevant here" }], "ZZZZ").length, 0);
  eq("the limit is honoured", Free.newsForSymbol(items, "TSLA", 1).length, 1);
  eq("a symbol with no alias still matches literally", Free.newsForSymbol([{ title: "COIN jumps on earnings" }], "COIN").length, 1);
}

console.log("\npaths");
eq("single-symbol path", Free.barsPath("spy", "5Min"), "/api/bars?symbol=SPY&tf=5Min");
eq("multi-symbol path", Free.symbolsPath(["SPY", "QQQ"], "1Day"), "/api/bars?symbols=SPY,QQQ&tf=1Day");
eq("the free timeframes are the ones the source can serve", Free.TIMEFRAMES.map((t) => t.id).join(","), "5Min,15Min,1Day");
ok("each timeframe has a periods-per-year for the volatility model", Free.TIMEFRAMES.every((t) => Free.PERIODS_PER_YEAR[t.id] > 0));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
