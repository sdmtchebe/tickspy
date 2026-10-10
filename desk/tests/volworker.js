/*
 * volworker.js — the Web Worker that keeps volatility training off the main
 * thread.
 *
 *   node desk/tests/volworker.js
 *
 * The worker itself adds no model logic: it importScripts the same
 * volmodel.js/volmodel2.js the page uses and forwards progress, the result and
 * errors over postMessage. What is worth pinning here is exactly that contract,
 * plus the two ways it could drift silently:
 *
 *   - the TensorFlow.js build it imports must be the one volmodel2.js expects,
 *     or the two halves train different networks;
 *   - the model files must be loaded before the first message can arrive, while
 *     TensorFlow.js must NOT be fetched until a job actually asks for it.
 *
 * No browser, no TensorFlow.js, no network: the engine is stubbed.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DESK = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(DESK, "volworker.js"), "utf8");

const failures = { count: 0 };
function ok(label, cond, extra) {
  if (!cond) failures.count++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
}

/* Build a sandbox that looks like a worker (or, without `imports`, like Node), a
 * fake importScripts that records what was asked for, and a fake postMessage
 * that records what came back. Each call gets its own sandbox and its own
 * handle(), which is the point: the worker closes over one global. */
function load({ imports = false, engine = null } = {}) {
  const imported = [];
  const posted = [];
  const sandbox = { console: { log() {}, error() {} } };
  sandbox.postMessage = (m) => posted.push(m);
  if (imports) {
    sandbox.importScripts = function () {
      const names = Array.prototype.slice.call(arguments);
      imported.push(names);
      // Stand in for the two real model files, and for the CDN build of TF.js.
      if (names.includes("volmodel2.js") && engine) sandbox.DeskVol2 = engine;
      if (names.some((n) => /(^|\/)tf(\.min)?\.js$/.test(n))) {
        sandbox.tf = { tensor() {}, sequential() {} };
      }
    };
  }
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "volworker.js" });
  const env = { sandbox, imported, posted, api: sandbox.__deskVolWorker };
  env.handle = (data) => env.api.handle(data, (m) => posted.push(m));
  return env;
}

/* A stand-in for DeskVol2 that records its arguments and reports progress. */
function stubEngine(onRun) {
  const seen = [];
  return {
    seen,
    run(bars, opts, report) {
      seen.push({ bars, opts });
      return Promise.resolve().then(() => onRun(bars, opts, report));
    },
  };
}

async function main() {
  const env = load();
  const api = env.api;
  console.log("volworker.js");

  ok("exports handle() for testing", !!api && typeof api.handle === "function");
  ok("loads both model files", JSON.stringify(api.MODELS) === JSON.stringify(["volmodel.js", "volmodel2.js"]), api.MODELS.join(", "));

  // --- the engine it asks for must be the one the page loads -----------------
  const vol2 = fs.readFileSync(path.join(DESK, "volmodel2.js"), "utf8");
  const pageUrl = (vol2.match(/var TF_URL\s*=\s*"([^"]+)"/) || [])[1];
  ok("TensorFlow.js URL matches volmodel2.js", !!pageUrl && pageUrl === api.TF_URL, api.TF_URL);
  for (const f of api.MODELS) {
    ok(`${f} exists beside the worker`, fs.existsSync(path.join(DESK, f)));
  }

  // --- progress then the result, under one id -------------------------------
  {
    const e = load();
    const engine = stubEngine((bars, opts, report) => {
      report({ stage: "prepare", pct: 0, message: "Building stage-1 features..." });
      report({ stage: "train", pct: 0.25, etaMs: 60000, epoch: 7, epochs: 90, folds: 1 });
      return { symbol: "SPY", predicted_volatility: 1.23, engine: "browser-js-tfjs" };
    });
    e.sandbox.DeskVol2 = engine;
    const bars = [{ t: "2026-10-08T14:30:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }];
    await e.handle({ id: 7, bars, opts: { symbol: "SPY", strict: false } });

    const progress = e.posted.filter((m) => m.type === "progress");
    ok("forwards every progress report", progress.length === 2, `(got ${progress.length})`);
    ok("progress keeps the enclosing id", e.posted.every((m) => m.id === 7));
    ok("progress carries the trainer's fields", (progress[1] || {}).info && progress[1].info.epoch === 7 && progress[1].info.etaMs === 60000);
    const done = e.posted[e.posted.length - 1];
    ok("finishes with the engine's payload", done.type === "done" && done.result.predicted_volatility === 1.23);
    ok("passes bars through untouched", engine.seen[0].bars === bars);
    ok("passes the options through", engine.seen[0].opts.symbol === "SPY" && engine.seen[0].opts.strict === false);
    ok("sends exactly one terminal message", e.posted.filter((m) => m.type === "done" || m.type === "error").length === 1);
  }

  // --- a missing engine is a message, not a crash ---------------------------
  {
    const e = load();
    await e.handle({ id: 1, bars: [], opts: {} });
    ok("no engine -> one error message", e.posted.length === 1 && e.posted[0].type === "error", e.posted[0] && e.posted[0].message);
    ok("the error names the engine", /did not load in the worker/.test(e.posted[0].message));
  }

  // --- an engine that throws is reported, never rethrown --------------------
  {
    const e = load();
    e.sandbox.DeskVol2 = {
      run() {
        return Promise.reject(new Error("Not enough clean sequences to train the LSTM"));
      },
    };
    let threw = false;
    try {
      await e.handle({ id: 3, bars: [], opts: {} });
    } catch (_) {
      threw = true;
    }
    ok("a failing run is reported, not thrown", !threw && e.posted[0] && e.posted[0].type === "error");
    ok("the failure reason survives", /clean sequences/.test(e.posted[0].message));
  }

  // --- as a real worker: eager models, lazy TensorFlow.js -------------------
  {
    const engine = stubEngine((bars, opts, report) => {
      report({ pct: 1, message: "done" });
      return { ok: true };
    });
    const wire = load({ imports: true, engine });

    ok("imports both model files at start", wire.imported.length === 1 && wire.imported[0].join(",") === "volmodel.js,volmodel2.js", JSON.stringify(wire.imported[0]));
    ok("does not fetch TensorFlow.js at start", !wire.imported.some((n) => n.some((x) => /tf/.test(x))));
    ok("wires onmessage", typeof wire.sandbox.onmessage === "function");

    wire.sandbox.onmessage({ data: { id: 42, bars: [{ o: 1, h: 1, l: 1, c: 1, v: 1 }], opts: { symbol: "SPY" } } });
    await new Promise((r) => setTimeout(r, 0));
    ok("the message handler posts the result", wire.posted.length === 2 && wire.posted[1].type === "done" && wire.posted[1].id === 42, JSON.stringify(wire.posted.map((m) => m.type)));
    ok(
      "TensorFlow.js is fetched on the first job, not before",
      wire.imported.length === 2 && /tf\.min\.js$/.test(wire.imported[1][0]),
      wire.imported.length > 1 ? wire.imported[1][0] : "(never)"
    );
  }

  console.log(failures.count ? `\n${failures.count} check(s) FAILED` : "\nall checks passed");
  process.exit(failures.count ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
