/*
 * The seam between the desk's free mode and the edge API.
 *
 *   node desk/tests/edge_integration.js
 *
 * freesrc.js and worker/src/bars.js are each tested on their own. What nothing
 * else covers is whether they actually fit together, and that is where a change
 * to either side breaks the desk silently:
 *
 *   - does /api/bars hand the desk bars the desk's own clock functions agree
 *     with (ET session times, ascending, inside the regular session)?
 *   - does the replay reveal a prefix that is long enough for the indicator
 *     panels, deep enough for prior-day levels, and never includes a bar from
 *     the future?
 *   - do the watchlist quotes and the multi-symbol path still line up?
 *
 * So this runs the real Worker handler against stubbed upstream CSVs and feeds
 * its JSON through the real freesrc.js, with no browser and no network.
 */
const path = require("path");
const Free = require(path.join(__dirname, "..", "freesrc.js"));

let failed = 0;
function ok(label, cond, extra) {
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
}
function eq(label, got, want) {
  ok(label, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/* Stooq stamps its CSV in Warsaw time. 09:30-15:55 ET on 2026-10-08 is
   15:30-21:55 CEST that day, so a faithful fixture is deliberately foreign. */
const SESSIONS = ["2026-10-06", "2026-10-07", "2026-10-08"];
const SESSION_DATE = SESSIONS[2];

function intradayRows(date, { startMin = 15 * 60 + 30, count = 78, base = 500 } = {}) {
  const rows = [];
  let px = base;
  for (let i = 0; i < count; i++) {
    const m = startMin + i * 5;
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const o = px;
    const c = px + 0.1;
    rows.push([`${date} ${hh}:${mm}:00`, o.toFixed(2), (c + 0.2).toFixed(2), (o - 0.2).toFixed(2), c.toFixed(2), String(1000 + i)]);
    px = c;
  }
  return rows;
}

const csv = (rows) => "Date,Open,High,Low,Close,Volume\n" + rows.map((r) => r.join(",")).join("\n") + "\n";

// Three complete sessions, plus a barely-started fourth that must be ignored.
const INTRADAY = csv([
  ...intradayRows(SESSIONS[0], { base: 480 }),
  ...intradayRows(SESSIONS[1], { base: 490 }),
  ...intradayRows(SESSION_DATE, { base: 500 }),
  ...intradayRows("2026-10-09", { count: 4, base: 512 }),
]);

const DAILY = csv([
  ["2026-10-02", "470.00", "476.00", "469.00", "475.00", "50000000"],
  ["2026-10-05", "475.50", "481.00", "474.00", "480.00", "51000000"],
  [SESSIONS[0], "480.00", "486.00", "479.00", "485.00", "52000000"],
  [SESSIONS[1], "485.00", "492.00", "484.00", "490.00", "53000000"],
  [SESSION_DATE, "500.00", "507.00", "499.00", "505.60", "57400000"],
]);

function stubUpstream() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.searchParams.get("s") === "bad.us") return new Response("No data", { status: 404 });
    return new Response(u.searchParams.get("i") === "d" ? DAILY : INTRADAY, { status: 200 });
  };
  return () => {
    globalThis.fetch = real;
  };
}

async function main() {
  const mod = await import("../../worker/src/index.js");
  const worker = mod.default;
  const env = { CACHE: null, ALLOWED_ORIGINS: "*" };

  const restore = stubUpstream();
  try {
    console.log("free mode against the real /api/bars handler");

    mod._memory.clear();
    const res = await worker.fetch(new Request("https://api.test/api/bars?symbol=SPY&tf=5Min"), env, {});
    eq("the endpoint answers without any API key", res.status, 200);
    const payload = await res.json();

    // ---- the session the desk will replay --------------------------------
    eq("the newest COMPLETE session is the one replayed", payload.sessionDate, SESSION_DATE);
    eq("it carries three sessions, so the indicators and prior-day levels have data", payload.sessions, 3);
    eq("and the desk's own label can name the source", payload.source, "stooq");

    const etDates = [...new Set(payload.bars.map((b) => Free.etDate(Date.parse(b.t))))];
    eq("every session survived the conversion", etDates.join(","), SESSIONS.join(","));
    ok(
      "no bar falls outside the regular session",
      payload.bars.every((b) => {
        const m = Free.etMinutes(Date.parse(b.t));
        return m >= Free.RTH_OPEN && m < Free.RTH_CLOSE;
      })
    );
    ok("bars are ascending", payload.bars.every((b, i) => i === 0 || payload.bars[i - 1].t <= b.t));

    // ---- the desk's replay over that payload -----------------------------
    const bars = payload.bars.map((b) => ({ t: new Date(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

    // 11:00 ET on the 9th is 11:00 ET on the session being replayed.
    const rep = Free.replayAt(Date.parse("2026-10-09T15:00:00Z"), payload.sessionDate);
    ok("the replay is mid-session", rep.live && !rep.complete);

    const shown = Free.reveal(bars, rep.at);
    eq("the replay ends on the replayed 11:00 bar", Free.etMinutes(shown[shown.length - 1].t), 11 * 60);
    ok("and never shows a later bar", shown.every((b) => b.t.getTime() <= rep.at.getTime()));
    // 40 is the desk's own threshold before it will compute indicators.
    ok("the revealed prefix is long enough for the indicator panels", shown.length >= 40, `(${shown.length} bars)`);
    const shownDates = new Set(shown.map((b) => Free.etDate(b.t.getTime())));
    ok("and deep enough for prior-day levels (more than one session in view)", shownDates.size >= 2, `(${shownDates.size} sessions)`);
    eq("the first revealed bar is a real session open", Free.etMinutes(shown[0].t), Free.RTH_OPEN);

    // Outside the session the whole thing is on screen, which is what a visitor
    // arriving in the evening should get.
    const done = Free.reveal(bars, Free.replayAt(Date.parse("2026-10-10T01:00:00Z"), payload.sessionDate).at);
    eq("after the close the replay is complete", done.length, payload.bars.length);

    // ---- the daily series the desk derives from --------------------------
    const last = payload.daily[payload.daily.length - 1];
    eq("daily bars end on the replayed session", Free.etDate(Date.parse(last.t)), SESSION_DATE);
    const i = payload.daily.findIndex((b) => Free.etDate(Date.parse(b.t)) === payload.sessionDate);
    ok("the prior close needed for the daily change is present", i >= 1);
    eq("and it is the right one", payload.daily[i - 1].c, 490);

    // ---- the watchlist path ---------------------------------------------
    mod._memory.clear();
    const multi = await (
      await worker.fetch(new Request("https://api.test/api/bars?symbols=SPY,QQQ,BAD&tf=1Day"), env, {})
    ).json();
    eq("the multi-symbol path reports the bad ticker without failing", Object.keys(multi.bars).length, 2);
    ok("and the desk can turn it into watchlist quotes", multi.errors.BAD);
    const quotes = Free.quotesFromDaily(multi.bars);
    eq("a quote is the last close", quotes.SPY.p, 505.6);
    eq("with the change against the previous close", Math.round(quotes.SPY.ch * 100) / 100, 3.18);
    eq("the biggest mover is the one with the larger move", Free.movers(quotes, 1)[0].s, "SPY");

    // ---- the volatility path, which trains on these daily bars -----------
    ok("there is enough daily history for the volatility model", payload.daily.length >= 2, `(${payload.daily.length} bars)`);
    ok(
      "and the daily series is usable in the volatility engine's own order",
      payload.daily.every((b, k) => k === 0 || payload.daily[k - 1].t < b.t)
    );

    // ---- what the visitor is told ----------------------------------------
    const text = Free.labelled(payload);
    ok("the disclosure names the session and denies being a live quote", /Oct/.test(text) && /not a current quote/i.test(text), text);
  } finally {
    restore();
  }

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("runner error:", e);
  process.exit(2);
});
