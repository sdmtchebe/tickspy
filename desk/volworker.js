/* volworker.js — the Desk's volatility model, moved off the main thread.
 *
 * Why this exists: the stage-2 LSTM is trained by TensorFlow.js, and TF.js runs
 * every tensor operation on whatever thread called it. Training in the page
 * therefore froze the whole desk - the chart stopped responding, the clock
 * stopped ticking and the progress bar sat still - for a minute or more, which
 * is exactly what a 2x64 LSTM over thousands of sequences costs. A Web Worker
 * has its own thread, so the identical code can train while the page stays
 * responsive and reports progress as it goes.
 *
 * It is deliberately the same code, not a second implementation: this file adds
 * no model logic at all. It importScripts() the very same volmodel.js and
 * volmodel2.js the page loads, so a forecast produced here is produced by the
 * same stage-1 features, the same LSTM and the same `finish()` backtest.
 *
 * Protocol
 *   in   { id, bars, opts }                     opts = { symbol, periodsPerYear, strict }
 *   out  { id, type: "progress", info }         info = { pct, etaMs, epoch, ... }
 *        { id, type: "done", result }           result = the DeskVol2.run() payload
 *        { id, type: "error", message }
 *
 * Cancelling is the main thread's job: it terminates the worker, which is why
 * the page also keeps its own abort path (a terminated worker never replies).
 *
 * IMPORTANT - NOT INVESTMENT ADVICE. Statistical estimates for research and
 * education only. See DISCLAIMER.md.
 */
(function (root) {
  "use strict";

  // Must stay the same build as desk/volmodel2.js loads, or the two could
  // disagree about numerics. tests/volworker.js asserts they match.
  var TF_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  var MODELS = ["volmodel.js", "volmodel2.js"];

  // In a real worker importScripts exists; under Node (the test) it does not, so
  // the test can preload a stub engine and drive handle() directly.
  var canImport = typeof importScripts === "function";

  function hasTf() {
    return !!root.tf && typeof root.tf.tensor === "function" && typeof root.tf.sequential === "function";
  }

  /* TensorFlow.js is fetched lazily, on the first job rather than at worker
   * start: most visits never open the Volatility tab, and a worker that is
   * created should not immediately pull 1 MB off a CDN. importScripts() is
   * synchronous, so by the time DeskVol2.run() asks for it, it is there. */
  function loadTf() {
    if (hasTf()) return;
    if (!canImport) return;
    importScripts(TF_URL);
  }

  /* Kept separate from onmessage so a Node test can drive it with a stub
   * engine: nothing here reaches into the DOM or the network. */
  function handle(data, post) {
    var id = (data && data.id) || 0;
    return Promise.resolve()
      .then(function () {
        if (!root.DeskVol2 || typeof root.DeskVol2.run !== "function") {
          throw new Error("the volatility engine did not load in the worker");
        }
        loadTf();
        return root.DeskVol2.run(data.bars, data.opts || {}, function (info) {
          post({ id: id, type: "progress", info: info });
        });
      })
      .then(function (result) {
        post({ id: id, type: "done", result: result });
      })
      .catch(function (e) {
        post({ id: id, type: "error", message: String((e && e.message) || e) });
      });
  }

  if (canImport) {
    // The model files first, so DeskVol/DeskVol2 exist before the first message
    // can arrive. Nothing else is loaded eagerly.
    importScripts.apply(null, MODELS);
    root.onmessage = function (e) {
      handle(e.data, function (m) {
        root.postMessage(m);
      });
    };
  }

  var api = { handle: handle, TF_URL: TF_URL, MODELS: MODELS };
  root.__deskVolWorker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
