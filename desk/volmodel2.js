/* volmodel2.js — browser stage-2 LSTM for the Desk.
 *
 * This is the missing half of volmodel.js: the 2x64 LSTM residual correction
 * that volatility_predictor.py trains in PyTorch. It runs the same way here —
 * no server, no pre-trained weights — by training the network in the browser
 * with TensorFlow.js.
 *
 * It deliberately shares stage 1 with volmodel.js rather than reimplementing it:
 *
 *   1. DeskVol.buildStage1(bars)  -> features, HAR residuals, direction labels
 *   2. this module trains / predicts the LSTM on exactly those arrays
 *   3. DeskVol.finish(stage1, s2) -> the final payload, backtest and series
 *
 * So a browser stage-2 can never quietly disagree with the stage-1 numbers.
 *
 * Faithful to volatility_predictor.py:
 *   - sequences of lookback 30 from [resid, atr_pct, ret, rel_vol, vol_z]
 *   - RobustScaler (median / IQR) fit on the usable rows
 *   - residual standardisation by the training mean/std
 *   - head of 4: a residual plus 3 direction logits
 *   - loss = MSE(residual) + 0.5 * class-weighted cross-entropy
 *   - Adam lr 5e-3, early stopping on a 15% tail of the training window
 *   - train on the first 80%, score the held-out last 20% (or 3 strict folds)
 *   - the correction is weighted by the RMSE improvement it actually earned
 *
 * TensorFlow.js is loaded lazily from a CDN, only when this runs, so the page
 * stays light for everyone who never opens the Volatility tab.
 *
 * IMPORTANT — NOT INVESTMENT ADVICE. Statistical estimates for research and
 * education only. See DISCLAIMER.md.
 */
(function (root) {
  "use strict";

  var TF_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";

  // Stage-2 configuration, mirroring volatility_predictor.py.
  var HIDDEN = 64;
  var DROPOUT = 0.2;
  var SEED = 7;
  var MAX_EPOCHS = 90;
  var PATIENCE = 12;
  var BATCH = 128;
  var MAX_TRAIN_SEQ = 4000;
  var MAX_VAL_SEQ = 1200;
  var VAL_FRAC = 0.15;
  var TEST_FRAC = 0.2;
  var LEARNING_RATE = 5e-3;
  var MIN_POSITIONS = 80;
  var STAGE2_FULL_IMPROVE = 5.0;
  var STRICT_FOLDS = [
    [0.55, 0.7],
    [0.7, 0.85],
    [0.85, 1.0],
  ];

  // ---------------------------------------------------------------- helpers --
  function isFiniteNum(x) {
    return typeof x === "number" && isFinite(x);
  }
  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }
  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }
  function meanAt(a, idx) {
    var s = 0,
      n = 0;
    for (var i = 0; i < idx.length; i++) {
      var v = a[idx[i]];
      if (isFiniteNum(v)) {
        s += v;
        n++;
      }
    }
    return n ? s / n : 0;
  }
  function stdAt(a, idx) {
    var m = meanAt(a, idx);
    var s = 0,
      n = 0;
    for (var i = 0; i < idx.length; i++) {
      var v = a[idx[i]];
      if (isFiniteNum(v)) {
        s += (v - m) * (v - m);
        n++;
      }
    }
    return n ? Math.sqrt(s / n) : 0;
  }
  function quantile(sortedAsc, q) {
    var n = sortedAsc.length;
    if (!n) return NaN;
    var pos = (n - 1) * q;
    var lo = Math.floor(pos),
      hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
  }
  function cleanRow(row) {
    var out = new Array(row.length);
    for (var i = 0; i < row.length; i++) out[i] = isFiniteNum(row[i]) ? row[i] : 0;
    return out;
  }

  // ------------------------------------------------------------------ scaler --
  // sklearn.preprocessing.RobustScaler: centre on the median, scale by the IQR,
  // and fall back to 1 when a column has no spread.
  function fitScaler(feats) {
    var rows = [];
    for (var i = 0; i < feats.length; i++) {
      var r = feats[i];
      if (!r) continue;
      var ok = true;
      for (var j = 0; j < r.length; j++) if (!isFiniteNum(r[j])) { ok = false; break; }
      if (ok) rows.push(r);
    }
    var k = feats[0] ? feats[0].length : 5;
    var center = new Array(k).fill(0);
    var scale = new Array(k).fill(1);
    if (!rows.length) return { center: center, scale: scale };
    for (j = 0; j < k; j++) {
      var col = rows.map(function (row) { return row[j]; }).sort(function (a, b) { return a - b; });
      center[j] = quantile(col, 0.5);
      var iqr = quantile(col, 0.75) - quantile(col, 0.25);
      scale[j] = iqr > 0 ? iqr : 1;
    }
    return { center: center, scale: scale };
  }

  function transformAll(feats, scaler) {
    var k = scaler.center.length;
    var out = new Array(feats.length);
    for (var i = 0; i < feats.length; i++) {
      var row = cleanRow(feats[i] || []);
      var t = new Array(k);
      for (var j = 0; j < k; j++) {
        var sc = scaler.scale[j];
        t[j] = sc ? (row[j] - scaler.center[j]) / sc : 0;
      }
      out[i] = t;
    }
    return out;
  }

  // Keep an evenly spread MAX_TRAIN_SEQ subset, as the Python model does with
  // np.linspace, so a 20k-bar history still trains in a sensible time.
  function capEven(pos, max) {
    if (pos.length <= max) return pos.slice();
    var out = new Array(max);
    for (var i = 0; i < max; i++) out[i] = pos[Math.round((i * (pos.length - 1)) / (max - 1))];
    return out;
  }

  function buildSequences(Xs, resid, dirs, posList, lookback) {
    var n = posList.length;
    var x = new Float32Array(n * lookback * 5);
    var y = new Float32Array(n);
    var d = new Int32Array(n);
    var p = 0;
    for (var i = 0; i < n; i++) {
      var j = posList[i];
      for (var t = j - lookback; t < j; t++) {
        var row = Xs[t];
        for (var f = 0; f < 5; f++) x[p++] = row[f];
      }
      y[i] = resid[j];
      d[i] = dirs[j];
    }
    return { n: n, x: x, y: y, d: d };
  }

  function encodeLabels(tf, seq) {
    var flat = new Float32Array(seq.n * 4);
    for (var i = 0; i < seq.n; i++) {
      flat[i * 4] = seq.y[i];
      flat[i * 4 + 1] = seq.d[i] === 0 ? 1 : 0;
      flat[i * 4 + 2] = seq.d[i] === 1 ? 1 : 0;
      flat[i * 4 + 3] = seq.d[i] === 2 ? 1 : 0;
    }
    return tf.tensor2d(flat, [seq.n, 4]);
  }

  // ------------------------------------------------------------- tf.js model --
  // The desk page has <select id="tf">, and an element with an id is exposed as
  // a global of the same name, so a bare `if (window.tf)` would find the
  // dropdown and never load the library. Check for the actual API instead.
  function isTfjs(t) {
    return !!t && typeof t.tensor === "function" && typeof t.sequential === "function";
  }

  function loadTf() {
    if (isTfjs(root.tf)) return Promise.resolve(root.tf);
    if (root.__deskTfPromise) return root.__deskTfPromise;
    root.__deskTfPromise = new Promise(function (resolve, reject) {
      if (typeof document === "undefined") {
        reject(new Error("TensorFlow.js cannot be loaded outside a browser."));
        return;
      }
      var s = document.createElement("script");
      s.src = TF_URL;
      s.async = true;
      s.onload = function () {
        isTfjs(root.tf)
          ? resolve(root.tf)
          : reject(new Error("TensorFlow.js loaded but window.tf is not the library (a " + (root.tf && root.tf.tagName ? "<" + root.tf.tagName.toLowerCase() + "> element" : typeof root.tf) + " is shadowing it)."));
      };
      s.onerror = function () {
        reject(new Error("Could not download TensorFlow.js from jsDelivr."));
      };
      document.head.appendChild(s);
    });
    return root.__deskTfPromise;
  }

  function buildModel(tf, lookback) {
    var m = tf.sequential();
    // Dropout on the second layer is the inter-layer dropout PyTorch applies
    // between stacked LSTM layers; the extra Dropout mirrors nn.Dropout(0.2).
    m.add(tf.layers.lstm({ units: HIDDEN, inputShape: [lookback, 5], returnSequences: true }));
    m.add(tf.layers.lstm({ units: HIDDEN, dropout: DROPOUT }));
    m.add(tf.layers.dropout({ rate: DROPOUT }));
    m.add(tf.layers.dense({ units: 4 }));
    return m;
  }

  // MSE(residual) + 0.5 * class-weighted cross-entropy over the 3 direction
  // logits. yTrue is [batch, 4]: the scaled residual followed by a one-hot
  // direction label. The weighting stops the direction head collapsing to
  // "neutral", then balanced accuracy exposes whether it has any real edge.
  function makeLoss(tf, classWeights) {
    return function (yTrue, yPred) {
      return tf.tidy(function () {
        var resTrue = yTrue.slice([0, 0], [-1, 1]);
        var resPred = yPred.slice([0, 0], [-1, 1]);
        var clsTrue = yTrue.slice([0, 1], [-1, 3]);
        var logits = yPred.slice([0, 1], [-1, 3]);
        var mse = tf.losses.meanSquaredError(resTrue, resPred);
        var logp = tf.logSoftmax(logits);
        var picked = tf.sum(logp.mul(clsTrue), -1);
        var w = tf.sum(clsTrue.mul(classWeights), -1);
        var ce = tf.neg(picked.mul(w)).mean();
        return mse.add(ce.mul(0.5));
      });
    };
  }

  function softmax3(v) {
    var m = Math.max(v[0], v[1], v[2]);
    var e = [Math.exp(v[0] - m), Math.exp(v[1] - m), Math.exp(v[2] - m)];
    var s = e[0] + e[1] + e[2] || 1;
    return [e[0] / s, e[1] / s, e[2] / s];
  }

  // ------------------------------------------------------------ one training --
  async function trainFold(tf, st, Xs, trainFrac, evalTo, lookback, hooks) {
    var positions = st.positions;
    var splitPos = Math.floor(positions.length * trainFrac);
    var testEnd = Math.floor(positions.length * evalTo);
    var trainPos = positions.slice(0, splitPos);
    var testPos = positions.slice(splitPos, testEnd);
    if (trainPos.length < 40 || testPos.length < 5) {
      throw new Error("Train/test split too small for the LSTM.");
    }

    var resMu = meanAt(st.resid, trainPos);
    var resSd = stdAt(st.resid, trainPos) || 1;
    var resScaled = new Array(st.n);
    for (var i = 0; i < st.n; i++) resScaled[i] = (st.resid[i] - resMu) / resSd;

    // Early stopping comes off the tail of the training region only.
    var valN = Math.max(8, Math.floor(trainPos.length * VAL_FRAC));
    var fitPos = capEven(trainPos.slice(0, trainPos.length - valN), MAX_TRAIN_SEQ);
    var valPos = trainPos.slice(trainPos.length - valN);
    if (valPos.length > MAX_VAL_SEQ) valPos = valPos.slice(valPos.length - MAX_VAL_SEQ);

    var Xt = buildSequences(Xs, resScaled, st.dirs, fitPos, lookback);
    var Xv = buildSequences(Xs, resScaled, st.dirs, valPos, lookback);
    if (Xt.n < 20 || Xv.n < 4) throw new Error("Not enough sequences after the val split.");

    var counts = [0, 0, 0];
    for (i = 0; i < Xt.n; i++) counts[Xt.d[i]]++;
    var weights = counts.map(function (c) {
      return clamp(Xt.n / Math.max(c * 3.0, 1.0), 0.2, 5.0);
    });

    var model = buildModel(tf, lookback);
    var wTensor = tf.tensor1d(weights, "float32");
    var optimizer = tf.train.adam(LEARNING_RATE);
    model.compile({ optimizer: optimizer, loss: makeLoss(tf, wTensor) });

    var xs = tf.tensor3d(Xt.x, [Xt.n, lookback, 5]);
    var ys = encodeLabels(tf, Xt);
    var xv = tf.tensor3d(Xv.x, [Xv.n, lookback, 5]);
    var yv = encodeLabels(tf, Xv);

    var best = Infinity;
    var bestWeights = null;
    var bad = 0;
    var epochsRun = 0;

    await model.fit(xs, ys, {
      epochs: MAX_EPOCHS,
      batchSize: Math.min(BATCH, Xt.n),
      shuffle: true,
      validationData: [xv, yv],
      callbacks: {
        onEpochEnd: async function (epoch, logs) {
          epochsRun = epoch + 1;
          var vl = logs && isFiniteNum(logs.val_loss) ? logs.val_loss : logs ? logs.loss : NaN;
          if (isFiniteNum(vl) && vl < best - 1e-6) {
            best = vl;
            if (bestWeights) bestWeights.forEach(function (t) { t.dispose(); });
            bestWeights = model.getWeights().map(function (t) { return t.clone(); });
            bad = 0;
          } else {
            bad++;
            if (bad >= PATIENCE) model.stopTraining = true;
          }
          if (hooks.onEpochEnd) hooks.onEpochEnd(epoch, MAX_EPOCHS, logs);
          if (tf.nextFrame) await tf.nextFrame();
          else await new Promise(function (r) { setTimeout(r, 0); });
          if (hooks.isCancelled && hooks.isCancelled()) model.stopTraining = true;
        },
      },
    });

    if (bestWeights) {
      model.setWeights(bestWeights);
      bestWeights.forEach(function (t) { t.dispose(); });
    }

    // Out-of-sample pass over the held-out window: no refitting.
    var Xte = buildSequences(Xs, resScaled, st.dirs, testPos, lookback);
    var xte = tf.tensor3d(Xte.x, [Xte.n, lookback, 5]);
    var resPred = new Array(Xte.n);
    var dirPred = new Array(Xte.n);
    var out = model.predict(xte);
    var vals = await out.array();
    for (i = 0; i < Xte.n; i++) {
      resPred[i] = vals[i][0] * resSd + resMu;
      var p = softmax3([vals[i][1], vals[i][2], vals[i][3]]);
      dirPred[i] = p[0] >= p[1] && p[0] >= p[2] ? 0 : p[2] >= p[1] ? 2 : 1;
    }
    out.dispose();
    xte.dispose();

    // Live one-step-ahead read from the very last usable bar.
    var lastPos = positions[positions.length - 1];
    var seqArr = new Float32Array(lookback * 5);
    var q = 0;
    for (var t = lastPos - lookback; t < lastPos; t++) {
      for (var f = 0; f < 5; f++) seqArr[q++] = Xs[t][f];
    }
    var xl = tf.tensor3d(seqArr, [1, lookback, 5]);
    var lo = model.predict(xl);
    var lv = await lo.array();
    lo.dispose();
    xl.dispose();

    var rawResidual = lv[0][0] * resSd + resMu;
    var lp = softmax3([lv[0][1], lv[0][2], lv[0][3]]);
    var cls = lp[0] >= lp[1] && lp[0] >= lp[2] ? 0 : lp[2] >= lp[1] ? 2 : 1;

    xs.dispose();
    ys.dispose();
    xv.dispose();
    yv.dispose();
    wTensor.dispose();
    model.dispose();

    return {
      testPos: testPos,
      resPred: resPred,
      dirPred: dirPred,
      rawResidual: rawResidual,
      direction: ["bearish", "neutral", "bullish"][cls],
      confidence: lp[cls],
      valLoss: best,
      epochsRun: epochsRun,
    };
  }

  // -------------------------------------------------------------- public API --
  // run(bars, opts, onProgress) -> the same payload shape as DeskVol.run(),
  // with stage 2 included. onProgress gets { stage, pct, etaMs, epoch, epochs,
  // fold, folds, message } so the UI can show a percentage and a time left.
  async function run(bars, opts, onProgress) {
    opts = opts || {};
    var report = typeof onProgress === "function" ? onProgress : function () {};
    var V = root.DeskVol;
    if (!V || !V.buildStage1 || !V.finish) {
      throw new Error("volmodel.js must be loaded before volmodel2.js.");
    }
    var lookback = V.config && V.config.lookback ? V.config.lookback : 30;
    var testFrac = V.config && V.config.testFrac ? V.config.testFrac : TEST_FRAC;

    report({ stage: "prepare", pct: 0, etaMs: null, message: "Building stage-1 features..." });
    var st = V.buildStage1(bars, opts);

    if (st.positions.length < MIN_POSITIONS) {
      throw new Error(
        "Not enough clean sequences to train the LSTM (" + st.positions.length + " usable, need " + MIN_POSITIONS + ")."
      );
    }

    var tf = opts.tf || (await loadTf());
    if (!tf) throw new Error("TensorFlow.js is unavailable.");

    var scaler = fitScaler(st.feats);
    var Xs = transformAll(st.feats, scaler);

    var strict = !!opts.strict;
    var folds = strict ? STRICT_FOLDS : [[1 - testFrac, 1.0]];
    var totalEpochs = folds.length * MAX_EPOCHS;
    var epochsDone = 0;
    // Recent epoch durations drive the estimate. Using the whole run instead
    // would keep the first (warm-up) epochs in the average and badly overstate
    // the time left.
    var epochStamps = [];

    function tick(extra) {
      var frac = clamp(epochsDone / totalEpochs, 0, 1);
      var etaMs = null;
      if (epochStamps.length >= 2) {
        var recent = epochStamps.slice(-8);
        var per = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
        etaMs = Math.max(0, Math.round(per * Math.max(0, totalEpochs - epochsDone)));
      }
      if (epochsDone >= totalEpochs) etaMs = 0;
      var info = { stage: "train", pct: frac, etaMs: etaMs, folds: folds.length };
      for (var k in extra) info[k] = extra[k];
      report(info);
    }

    var resByPos = {};
    var dirByPos = {};
    var lastRead = null;

    for (var fi = 0; fi < folds.length; fi++) {
      var fr = folds[fi];
      report({
        stage: "train",
        pct: epochsDone / totalEpochs,
        etaMs: null,
        fold: fi + 1,
        folds: folds.length,
        message:
          "Training fold " + (fi + 1) + " of " + folds.length + " (this is the slow part)...",
      });
      var foldRes = await trainFold(tf, st, Xs, fr[0], fr[1], lookback, {
        isCancelled: opts.isCancelled,
        onEpochEnd: function (epoch, epochs) {
          epochsDone++;
          epochStamps.push(now());
          tick({ fold: fi + 1, folds: folds.length, epoch: epoch + 1, epochs: epochs });
        },
      });
      for (var i = 0; i < foldRes.testPos.length; i++) {
        resByPos[foldRes.testPos[i]] = foldRes.resPred[i];
        dirByPos[foldRes.testPos[i]] = foldRes.dirPred[i];
      }
      lastRead = foldRes;
      epochsDone = (fi + 1) * MAX_EPOCHS;
      if (opts.isCancelled && opts.isCancelled()) break;
    }

    if (!lastRead) throw new Error("Stage 2 did not complete a single fold.");

    // Gate the LSTM by the RMSE improvement it actually delivered, pooled over
    // every held-out fold exactly as the Python model pools them.
    var pooled = Object.keys(resByPos).map(function (k) { return +k; });
    var sLin = 0,
      sComb = 0,
      m = 0;
    for (i = 0; i < pooled.length; i++) {
      var p = pooled[i];
      var linV = st.lin[p];
      var combV = linV + resByPos[p];
      var trueV = st.rv[p];
      if (isFiniteNum(linV) && isFiniteNum(trueV)) {
        sLin += (linV - trueV) * (linV - trueV);
        sComb += (combV - trueV) * (combV - trueV);
        m++;
      }
    }
    var rmseLin = m ? Math.sqrt(sLin / m) : NaN;
    var rmseComb = m ? Math.sqrt(sComb / m) : NaN;
    var improve = isFiniteNum(rmseLin) && rmseLin > 0 ? 100 * (1 - rmseComb / rmseLin) : NaN;

    var stage2Weight = isFiniteNum(improve) && improve > 0 ? Math.min(1, improve / STAGE2_FULL_IMPROVE) : 0;
    var rawResidual = lastRead.rawResidual;
    var cap = st.linNext ? 0.5 * Math.abs(st.linNext) : 0;
    if (cap && Math.abs(rawResidual) > cap) {
      rawResidual = Math.sign(rawResidual) * cap;
      st.warnings.push("LSTM residual clipped to +/-50% of the linear forecast.");
    }
    if (stage2Weight <= 0) {
      st.warnings.push(
        "Stage 2 added no measurable accuracy out of sample, so its correction was " +
          "weighted to zero and the forecast is effectively stage 1 only."
      );
    }

    report({ stage: "done", pct: 1, etaMs: 0, message: "Scoring the forecast..." });

    return V.finish(st, {
      resByPos: resByPos,
      dirByPos: dirByPos,
      residual: stage2Weight * rawResidual,
      rawResidual: rawResidual,
      stage2Weight: stage2Weight,
      direction: lastRead.direction,
      confidence: lastRead.confidence,
      folds: folds.length,
      strict: strict,
    });
  }

  var api = {
    run: run,
    loadTf: loadTf,
    _internal: {
      fitScaler: fitScaler,
      transformAll: transformAll,
      buildSequences: buildSequences,
      capEven: capEven,
      softmax3: softmax3,
      config: { HIDDEN: HIDDEN, MAX_EPOCHS: MAX_EPOCHS, BATCH: BATCH, SEED: SEED, STRICT_FOLDS: STRICT_FOLDS },
    },
  };
  root.DeskVol2 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
