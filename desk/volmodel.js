/* volmodel.js — browser stage-1 volatility engine for the Desk.
 *
 * This is a faithful JavaScript port of the *statistical* half of
 * volatility_predictor.py, so the Volatility tab works on a static host
 * (GitHub Pages) where no Python process can run:
 *
 *   - Garman-Klass realized volatility (RV_GK) from OHLC bars
 *   - HAR(1,5,22) fitted with an expanding walk-forward, so every one-step
 *     forecast is genuinely out of sample
 *   - GARCH(1,1) one-step cross-check on log returns
 *   - the same chronological hold-out backtest, regimes, uncertainty band,
 *     reliability gating and chart series
 *
 * Stage 2 (the 2x64 LSTM) is not built here: it is trained in the browser by
 * volmodel2.js, which calls buildStage1() below for the features and then hands
 * its out-of-sample output to finish(). With no stage 2 the residual correction
 * is exactly zero and the directional read is reported as unavailable rather
 * than invented.
 *
 * Output keys match the server payload so the existing renderer works unchanged.
 *
 * IMPORTANT - NOT INVESTMENT ADVICE. Statistical estimates for research and
 * education only. See DISCLAIMER.md.
 */
(function (root) {
  "use strict";

  var LOOKBACK = 30;
  var MIN_BARS = 120;
  var HAR_MIN_TRAIN = 40;
  var DIR_NEUTRAL_Q = 0.6;
  var DIR_THRESHOLD = 0.02;
  var TEST_FRAC = 0.2;
  var VOL_WIN = 20;
  var MODEL = "HAR(1,5,22) + GARCH(1,1) (browser stage 1)";
  var MODEL2 = "HAR(1,5,22) + GARCH(1,1) -> LSTM(64x2) (browser)";

  // ---------------------------------------------------------------- helpers --
  function isFiniteNum(x) {
    return typeof x === "number" && isFinite(x);
  }

  function num(x) {
    var v = typeof x === "number" ? x : parseFloat(x);
    return isFinite(v) ? v : NaN;
  }

  function mean(a, lo, hi) {
    if (lo === undefined) lo = 0;
    if (hi === undefined) hi = a.length;
    var s = 0,
      n = 0;
    for (var i = lo; i < hi; i++) {
      if (isFiniteNum(a[i])) {
        s += a[i];
        n++;
      }
    }
    return n ? s / n : NaN;
  }

  // ddof=0 like numpy's default, or 1 like pandas rolling().std().
  function std(a, ddof) {
    ddof = ddof || 0;
    var m = mean(a);
    var n = 0,
      s = 0;
    for (var i = 0; i < a.length; i++) {
      if (isFiniteNum(a[i])) {
        s += (a[i] - m) * (a[i] - m);
        n++;
      }
    }
    if (n - ddof <= 0) return NaN;
    return Math.sqrt(s / (n - ddof));
  }

  function rollingMean(a, w) {
    var out = new Array(a.length).fill(NaN);
    var s = 0;
    for (var i = 0; i < a.length; i++) {
      s += a[i];
      if (i >= w) s -= a[i - w];
      if (i >= w - 1 && isFiniteNum(s)) out[i] = s / w;
      if (!isFiniteNum(a[i])) s = NaN; // mirrors min_periods=w (NaN poisons the window)
    }
    return out;
  }

  function rollingStd(a, w) {
    var out = new Array(a.length).fill(NaN);
    for (var i = w - 1; i < a.length; i++) {
      var win = a.slice(i - w + 1, i + 1);
      var bad = false;
      for (var k = 0; k < win.length; k++) if (!isFiniteNum(win[k])) bad = true;
      if (!bad) out[i] = std(win, 1);
    }
    return out;
  }

  // numpy.quantile default ("linear") interpolation.
  function quantile(sortedAsc, q) {
    var n = sortedAsc.length;
    if (!n) return NaN;
    var pos = (n - 1) * q;
    var lo = Math.floor(pos),
      hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
  }

  // numpy.nanvar (ddof=0) over finite entries.
  function nanvar(a) {
    var m = mean(a);
    var n = 0,
      s = 0;
    for (var i = 0; i < a.length; i++) {
      if (isFiniteNum(a[i])) {
        s += (a[i] - m) * (a[i] - m);
        n++;
      }
    }
    return n ? s / n : NaN;
  }

  var LN2 = Math.log(2);

  function garmanKlass(o, h, l, c) {
    var out = new Array(o.length);
    for (var i = 0; i < o.length; i++) {
      var hl = Math.log(Math.max(h[i], 1e-12) / Math.max(l[i], 1e-12));
      var co = Math.log(Math.max(c[i], 1e-12) / Math.max(o[i], 1e-12));
      var v = 0.5 * hl * hl - (2 * LN2 - 1) * co * co;
      out[i] = Math.sqrt(Math.max(v, 0)) * 100;
    }
    return out;
  }

  function etDate(ms) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  // ------------------------------------------------------- OLS (4 columns) --
  function solveNormal(A, b) {
    var n = b.length;
    var M = [];
    for (var i = 0; i < n; i++) M.push(A[i].slice().concat([b[i]]));
    var scale = 0;
    for (i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    var tol = 1e-12 * (scale || 1);
    for (var col = 0; col < n; col++) {
      var piv = -1,
        best = 0;
      for (var r = col; r < n; r++) {
        var v = Math.abs(M[r][col]);
        if (v > best) {
          best = v;
          piv = r;
        }
      }
      if (piv < 0 || best <= tol) return null; // singular -> caller skips refit
      var tmp = M[col];
      M[col] = M[piv];
      M[piv] = tmp;
      var d = M[col][col];
      for (var c = col; c <= n; c++) M[col][c] /= d;
      for (r = 0; r < n; r++) {
        if (r === col) continue;
        var f = M[r][col];
        if (!f) continue;
        for (c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    return M.map(function (row) {
      return row[n];
    });
  }

  // Least squares on rows X[0..end) against y, ignoring non-finite rows.
  function ols(X, y, end) {
    var k = 0;
    for (var s = 0; s < end; s++) {
      if (X[s]) {
        k = X[s].length;
        break;
      }
    }
    if (!k) return { beta: null, count: 0 };
    var A = [];
    for (var i = 0; i < k; i++) A.push(new Array(k).fill(0));
    var b = new Array(k).fill(0);
    var count = 0;
    for (i = 0; i < end; i++) {
      var xi = X[i];
      var yi = y[i];
      if (!xi || !isFiniteNum(yi)) continue;
      var ok = true;
      for (var j = 0; j < k; j++) {
        if (!isFiniteNum(xi[j])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      count++;
      for (var p = 0; p < k; p++) {
        b[p] += xi[p] * yi;
        for (var q = p; q < k; q++) A[p][q] += xi[p] * xi[q];
      }
    }
    for (p = 0; p < k; p++) for (q = 0; q < p; q++) A[p][q] = A[q][p];
    return { beta: solveNormal(A, b), count: count };
  }

  function harDesign(rv) {
    var n = rv.length;
    var X = new Array(n).fill(null);
    for (var t = 22; t < n; t++) {
      X[t] = [1, rv[t - 1], mean(rv, t - 5, t), mean(rv, t - 22, t)];
    }
    return X;
  }

  function harWalkForward(rv, minTrain) {
    var n = rv.length;
    var X = harDesign(rv);
    var lin = new Array(n).fill(NaN);
    var refitEvery = Math.max(1, Math.floor(n / 400));
    var beta = null;
    for (var t = minTrain; t < n; t++) {
      if (beta === null || (t - minTrain) % refitEvery === 0) {
        var fit = ols(X, rv, t);
        if (fit.count < 20) continue;
        if (fit.beta === null) {
          beta = null;
          continue;
        }
        beta = fit.beta;
      }
      if (beta !== null && X[t]) {
        lin[t] = X[t][0] * beta[0] + X[t][1] * beta[1] + X[t][2] * beta[2] + X[t][3] * beta[3];
      }
    }
    return { X: X, lin: lin };
  }

  function harNext(rv) {
    var X = harDesign(rv);
    var fit = ols(X, rv, rv.length);
    if (fit.count < 20 || fit.beta === null) return NaN;
    var beta = fit.beta;
    var last = rv.length - 1;
    return (
      beta[0] +
      beta[1] * rv[last] +
      beta[2] * mean(rv, last - 4, last + 1) +
      beta[3] * mean(rv, last - 21, last + 1)
    );
  }

  // ------------------------------------------------------------- GARCH(1,1) --
  // Direct Gaussian MLE over (omega, alpha, beta) with a constant mean, matching
  // arch_models' mean="Constant", vol="GARCH", p=q=1, dist="normal". arch cannot
  // be ported exactly (its SLSQP starting values and backcast initialisation
  // differ), so this is an independently-converged estimate, not a bit-identical
  // one; the parity harness bounds how far it may drift.
  function nelderMead(f, x0, steps, maxIter, tol) {
    var n = x0.length;
    var simplex = [x0.slice()];
    var i;
    for (i = 0; i < n; i++) {
      var p = x0.slice();
      p[i] += steps[i];
      simplex.push(p);
    }
    var vals = simplex.map(f);
    var idx = [];
    for (var it = 0; it < maxIter; it++) {
      idx = simplex.map(function (_, k) {
        return k;
      }).sort(function (a, b) {
        return vals[a] - vals[b];
      });
      if (Math.abs(vals[idx[n]] - vals[idx[0]]) / (Math.abs(vals[idx[0]]) + 1e-12) < tol) break;
      var worst = simplex[idx[n]];
      var centroid = new Array(n).fill(0);
      for (i = 0; i < n; i++) {
        var s = 0;
        for (var k2 = 0; k2 < n; k2++) s += simplex[idx[k2]][i];
        centroid[i] = s / n;
      }
      var refl = centroid.map(function (cc, k) {
        return cc + (cc - worst[k]);
      });
      var fr = f(refl);
      if (fr < vals[idx[0]]) {
        var expn = centroid.map(function (cc, k) {
          return cc + 2 * (cc - worst[k]);
        });
        var fe = f(expn);
        if (fe < fr) {
          simplex[idx[n]] = expn;
          vals[idx[n]] = fe;
        } else {
          simplex[idx[n]] = refl;
          vals[idx[n]] = fr;
        }
      } else if (fr < vals[idx[n - 1]]) {
        simplex[idx[n]] = refl;
        vals[idx[n]] = fr;
      } else {
        var contr = centroid.map(function (cc, k) {
          return cc + 0.5 * (worst[k] - cc);
        });
        var fc = f(contr);
        if (fc < vals[idx[n]]) {
          simplex[idx[n]] = contr;
          vals[idx[n]] = fc;
        } else {
          for (var k3 = 1; k3 <= n; k3++) {
            var v = idx[k3];
            var b = simplex[idx[0]];
            simplex[v] = b.map(function (bv, k) {
              return bv + 0.5 * (simplex[v][k] - bv);
            });
            vals[v] = f(simplex[v]);
          }
        }
      }
    }
    var bi = 0;
    for (i = 1; i < vals.length; i++) if (vals[i] < vals[bi]) bi = i;
    return simplex[bi];
  }

  function garchNext(r) {
    var x = [];
    for (var i = 0; i < r.length; i++) if (isFiniteNum(r[i])) x.push(r[i]);
    if (x.length < 50) return NaN;
    var m = mean(x);
    if (!(std(x, 0) > 0)) return NaN;

    var eps = x.map(function (v) {
      return v - m;
    });
    var target = mean(
      eps.map(function (v) {
        return v * v;
      })
    );
    if (!(target > 0)) return NaN;

    // arch initialises the variance recursion with an exponentially-weighted
    // "backcast" of the earliest squared residuals rather than the unconditional
    // variance. Matching that convention is what puts this estimate next to
    // arch's parameters instead of 5% away (see tests/volmodel_parity.js).
    var init = (function () {
      var m2 = Math.min(75, eps.length);
      var num = 0,
        den = 0;
      for (var k = 0; k < m2; k++) {
        var w = Math.pow(0.94, k);
        num += w * eps[k] * eps[k];
        den += w;
      }
      return den > 0 ? num / den : target;
    })();
    if (!(init > 0)) init = target;

    function nll(p) {
      var omega = p[0],
        alpha = p[1],
        beta = p[2];
      // Only guard against sign violations and explosive recursion. The fitted
      // optimum can legitimately sit at alpha+beta ~= 1 (IGARCH-like); an earlier
      // alpha+beta < 1 cutoff silently excluded it and biased the estimate.
      if (!(omega > 0) || !(alpha >= 0) || !(beta >= 0) || alpha + beta >= 1.5) return Infinity;
      var s2 = init;
      var ll = 0;
      for (var t = 0; t < eps.length; t++) {
        if (!(s2 > 0) || !isFinite(s2)) return Infinity;
        ll += Math.log(s2) + (eps[t] * eps[t]) / s2;
        s2 = omega + alpha * eps[t] * eps[t] + beta * s2;
      }
      return ll / eps.length;
    }

    var best = nelderMead(
      nll,
      [target * 0.002, 0.05, 0.95],
      [target * 0.001, 0.02, 0.02],
      800,
      1e-11
    );
    if (!best) return NaN;
    var omega = best[0],
      alpha = best[1],
      beta = best[2];
    var s2 = init;
    for (var t2 = 0; t2 < eps.length; t2++) {
      s2 = omega + alpha * eps[t2] * eps[t2] + beta * s2;
    }
    return Math.sqrt(Math.max(s2, 0));
  }

  // ---------------------------------------------------------------- ingestion --
  function toCleanBars(bars) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i] || {};
      var o = num(b.o !== undefined ? b.o : b.open);
      var h = num(b.h !== undefined ? b.h : b.high);
      var l = num(b.l !== undefined ? b.l : b.low);
      var c = num(b.c !== undefined ? b.c : b.close);
      var v = num(b.v !== undefined ? b.v : b.volume);
      if (!isFiniteNum(v)) v = 0;
      if (![o, h, l, c].every(isFiniteNum)) continue;
      var t = b.t !== undefined ? b.t : b.timestamp;
      var ms = t == null ? NaN : new Date(t).getTime();
      var key = isFiniteNum(ms) ? String(ms) : String(i);
      if (seen[key] !== undefined) {
        out[seen[key]] = { t: ms, o: o, h: h, l: l, c: c, v: v }; // keep last
      } else {
        seen[key] = out.length;
        out.push({ t: ms, o: o, h: h, l: l, c: c, v: v });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ engine --
  // Stage 1: everything up to, but not including, the forecast and the
  // backtest. Exposed so volmodel2.js can train an LSTM on the same features
  // and then hand its out-of-sample output back to `finish`.
  function buildStage1(bars, opts) {
    opts = opts || {};
    var symbol = String(opts.symbol || "SPY").toUpperCase();
    var ppy = opts.periodsPerYear || null;
    var warnings = [];

    var bars2 = toCleanBars(bars || []);
    if (bars2.length < MIN_BARS) {
      throw new Error(
        "Need at least " + MIN_BARS + " usable bars for a stage-1 fit, got " + bars2.length + "."
      );
    }

    var n = bars2.length;
    var o = [],
      h = [],
      l = [],
      c = [],
      v = [],
      ts = [];
    for (var i = 0; i < n; i++) {
      o.push(bars2[i].o);
      h.push(bars2[i].h);
      l.push(bars2[i].l);
      c.push(bars2[i].c);
      v.push(bars2[i].v);
      ts.push(bars2[i].t);
    }

    // Session boundaries: the overnight gap is one huge bar-to-bar return per
    // session, so those returns are masked and boundary true range uses the
    // intra-bar range only.
    var boundary = new Array(n).fill(false);
    var haveTs = ts.every(isFiniteNum);
    if (haveTs) {
      for (i = 1; i < n; i++) boundary[i] = etDate(ts[i]) !== etDate(ts[i - 1]);
    }

    var r = new Array(n).fill(NaN);
    for (i = 1; i < n; i++) r[i] = Math.log(c[i] / c[i - 1]) * 100;
    for (i = 0; i < n; i++) if (boundary[i]) r[i] = NaN;

    var rv = garmanKlass(o, h, l, c);

    var prevClose = [c[0]].concat(c.slice(0, n - 1));
    var tr = new Array(n);
    for (i = 0; i < n; i++) {
      tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - prevClose[i]), Math.abs(l[i] - prevClose[i]));
      if (boundary[i]) tr[i] = h[i] - l[i];
    }
    var atr = rollingMean(tr, 14);
    var atrPct = new Array(n);
    for (i = 0; i < n; i++) atrPct[i] = (atr[i] / Math.max(c[i], 1e-12)) * 100;

    var vmean = rollingMean(v, VOL_WIN);
    var vstd = rollingStd(v, VOL_WIN);
    var relVol = new Array(n),
      volZ = new Array(n);
    for (i = 0; i < n; i++) {
      relVol[i] = v[i] / Math.max(vmean[i], 1e-9);
      volZ[i] = (v[i] - vmean[i]) / Math.max(vstd[i], 1e-9);
    }

    var wf = harWalkForward(rv, HAR_MIN_TRAIN);
    var lin = wf.lin;
    var resid = new Array(n);
    for (i = 0; i < n; i++) resid[i] = rv[i] - lin[i];

    // Adaptive neutral band, fit on the first 80% only.
    var finiteAbs = [];
    for (i = 0; i < n; i++) if (isFiniteNum(r[i])) finiteAbs.push(Math.abs(r[i]));
    var dirThr = DIR_THRESHOLD;
    if (finiteAbs.length > 40) {
      var head = finiteAbs.slice(0, Math.floor(finiteAbs.length * 0.8)).sort(function (a, b) {
        return a - b;
      });
      dirThr = Math.max(DIR_THRESHOLD, quantile(head, DIR_NEUTRAL_Q));
    }

    // 0 = bearish, 1 = neutral, 2 = bullish, the same labelling the Python
    // model uses. Stage 2 trains its direction head on these.
    var dirs = new Array(n);
    for (i = 0; i < n; i++) {
      dirs[i] = isFiniteNum(r[i]) ? (r[i] > dirThr ? 2 : r[i] < -dirThr ? 0 : 1) : NaN;
    }

    var feats = new Array(n);
    for (i = 0; i < n; i++) feats[i] = [resid[i], atrPct[i], r[i], relVol[i], volZ[i]];

    // Out-of-sample window, matching the server's positions/split exactly.
    var positions = [];
    for (var j = LOOKBACK; j < n; j++) {
      var okJ = isFiniteNum(resid[j]);
      if (okJ) {
        for (var f = 0; f < 5; f++) if (!isFiniteNum(feats[j][f])) { okJ = false; break; }
      }
      if (okJ) {
        for (var q = j - LOOKBACK; q < j; q++) {
          for (f = 0; f < 5; f++) if (!isFiniteNum(feats[q][f])) { okJ = false; break; }
          if (!okJ) break;
        }
      }
      if (okJ) positions.push(j);
    }
    var splitPos = Math.floor(positions.length * (1 - TEST_FRAC));
    var testPos = positions.slice(splitPos);

    var linNext = harNext(rv);
    if (!isFiniteNum(linNext)) {
      linNext = rv[n - 1];
      warnings.push("HAR fit failed; fell back to last realized volatility.");
    }
    var garch = garchNext(r);
    if (!isFiniteNum(garch)) warnings.push("GARCH(1,1) did not converge; using HAR only.");

    // Everything stage 2 needs (features, residuals, labels, positions) plus
    // everything `finish` needs. Splitting here is what lets volmodel2.js train
    // an LSTM on these exact features and then be scored through this module's
    // backtest, so a browser stage-2 cannot quietly disagree with stage 1.
    return {
      symbol: symbol,
      ppy: ppy,
      warnings: warnings,
      n: n,
      ts: ts,
      haveTs: haveTs,
      boundary: boundary,
      rv: rv,
      lin: lin,
      resid: resid,
      dirs: dirs,
      dirThr: dirThr,
      feats: feats,
      positions: positions,
      splitPos: splitPos,
      testPos: testPos,
      linNext: linNext,
      garch: garch,
    };
  }

  // ---------------------------------------------------------- stage-2 bridge --
  // `s2` is null for a stage-1-only fit, or the object volmodel2.js produces:
  //   { resByPos, dirByPos, residual, rawResidual, stage2Weight, direction,
  //     confidence, folds, strict }
  // resByPos / dirByPos map a bar index -> the LSTM's out-of-sample residual and
  // direction call, so the backtest and the chart can include stage 2.
  function finish(st, s2) {
    var warnings = st.warnings;
    var n = st.n;
    var ts = st.ts;
    var haveTs = st.haveTs;
    var boundary = st.boundary;
    var rv = st.rv;
    var lin = st.lin;
    var dirs = st.dirs;
    var testPos = st.testPos;
    var linNext = st.linNext;
    var garch = st.garch;
    var dirThr = st.dirThr;
    var ppy = st.ppy;
    var symbol = st.symbol;
    var i;

    var resByPos = null;
    var dirByPos = null;
    var residual = 0;
    var rawResidual = 0;
    var stage2Weight = 0;
    var direction = "neutral";
    var confidence = null;
    var folds = 1;
    var strict = false;

    if (s2) {
      resByPos = s2.resByPos || null;
      dirByPos = s2.dirByPos || null;
      residual = s2.residual || 0;
      rawResidual = s2.rawResidual || 0;
      stage2Weight = s2.stage2Weight || 0;
      direction = s2.direction || "neutral";
      confidence = s2.confidence == null ? null : s2.confidence;
      folds = s2.folds || 1;
      strict = !!s2.strict;
    } else {
      warnings.push(
        "Stage 2 (LSTM) did not run, so this is a stage-1 forecast and the " +
          "directional read is unavailable."
      );
    }

    // ---- backtest: stage 1, plus the LSTM residual when stage 2 ran ----
    var backtest = null;
    var series = { labels: [], realized: [], linear: [], combined: [] };
    if (testPos.length) {
      var rvT = testPos.map(function (p) {
        return rv[p];
      });
      var linT = testPos.map(function (p) {
        return lin[p];
      });
      var persist = testPos.map(function (p) {
        return rv[p - 1];
      });
      var predT = testPos.map(function (p) {
        return lin[p] + (resByPos ? resByPos[p] || 0 : 0);
      });

      function rmse(a) {
        var s = 0,
          m = 0;
        for (var k = 0; k < a.length; k++) {
          if (isFiniteNum(a[k]) && isFiniteNum(rvT[k])) {
            s += (a[k] - rvT[k]) * (a[k] - rvT[k]);
            m++;
          }
        }
        return m ? Math.sqrt(s / m) : NaN;
      }
      function mae(a) {
        var s = 0,
          m = 0;
        for (var k = 0; k < a.length; k++) {
          if (isFiniteNum(a[k]) && isFiniteNum(rvT[k])) {
            s += Math.abs(a[k] - rvT[k]);
            m++;
          }
        }
        return m ? s / m : NaN;
      }

      var rmseLin = rmse(linT),
        rmsePersist = rmse(persist),
        rmseComb = rmse(predT);
      var vt = nanvar(rvT);
      var r2 = vt > 0 ? 1 - nanvar(predT.map(function (x, k) { return x - rvT[k]; })) / vt : NaN;

      // Direction metrics exist only when stage 2 ran: stage 1 makes no
      // directional call, so they stay null rather than being invented.
      var dirAcc = null,
        dirBase = null,
        balAcc = null,
        nnAcc = null,
        predDist = null,
        trueDist = null;
      if (dirByPos) {
        var trueDir = testPos.map(function (p) { return dirs[p]; });
        var predDir = testPos.map(function (p) { return dirByPos[p]; });
        var hit = 0,
          cnt = 0,
          neut = 0,
          nnT = 0,
          nnC = 0,
          k2;
        var pd = [0, 0, 0],
          td = [0, 0, 0];
        for (k2 = 0; k2 < trueDir.length; k2++) {
          if (!isFiniteNum(trueDir[k2]) || !isFiniteNum(predDir[k2])) continue;
          cnt++;
          if (predDir[k2] === trueDir[k2]) hit++;
          if (trueDir[k2] === 1) neut++;
          if (trueDir[k2] !== 1) {
            nnT++;
            if (predDir[k2] === trueDir[k2]) nnC++;
          }
          pd[predDir[k2]]++;
          td[trueDir[k2]]++;
        }
        dirAcc = cnt ? hit / cnt : NaN;
        dirBase = cnt ? neut / cnt : NaN;
        nnAcc = nnT ? nnC / nnT : NaN;
        predDist = pd.map(function (v) { return cnt ? v / cnt : NaN; });
        trueDist = td.map(function (v) { return cnt ? v / cnt : NaN; });
        // Balanced (per-class) accuracy: the honest direction score.
        var recalls = [];
        for (var c0 = 0; c0 < 3; c0++) {
          var tot = 0,
            corr = 0;
          for (k2 = 0; k2 < trueDir.length; k2++) {
            if (!isFiniteNum(trueDir[k2]) || !isFiniteNum(predDir[k2])) continue;
            if (trueDir[k2] === c0) {
              tot++;
              if (predDir[k2] === c0) corr++;
            }
          }
          if (tot) recalls.push(corr / tot);
        }
        balAcc = recalls.length
          ? recalls.reduce(function (a, b) { return a + b; }, 0) / recalls.length
          : NaN;
      }

      backtest = {
        samples: testPos.length,
        vol_mae_linear: mae(linT),
        vol_rmse_linear: rmseLin,
        vol_mae_combined: mae(predT),
        vol_rmse_combined: rmseComb,
        vol_rmse_persistence: rmsePersist,
        direction_accuracy: dirAcc,
        direction_baseline: dirBase,
        direction_balanced_accuracy: balAcc,
        direction_nonneutral_accuracy: nnAcc,
        direction_pred_dist: predDist,
        direction_true_dist: trueDist,
        direction_threshold_pct: dirThr,
        combined_vs_linear_pct:
          isFiniteNum(rmseLin) && rmseLin > 0 ? 100 * (1 - rmseComb / rmseLin) : NaN,
        combined_vs_persistence_pct:
          isFiniteNum(rmsePersist) && rmsePersist > 0 ? 100 * (1 - rmseComb / rmsePersist) : NaN,
        r2_combined: r2,
        folds: folds,
      };

      var tail = testPos.slice().sort(function (a, b) { return a - b; }).slice(-160);
      series = {
        labels: tail.map(function (p) {
          return haveTs ? new Date(ts[p]).toISOString() : String(p);
        }),
        realized: tail.map(function (p) { return round(rv[p], 5); }),
        linear: tail.map(function (p) { return round(lin[p], 5); }),
        combined: tail.map(function (p) {
          return round(lin[p] + (resByPos ? resByPos[p] || 0 : 0), 5);
        }),
      };
    } else {
      warnings.push("Not enough clean out-of-sample bars for a backtest.");
    }

    var pred = Math.max(0, linNext + residual);
    var cur = rv[n - 1];
    var pct = mean(rv.map(function (x) { return x <= pred ? 1 : 0; }));
    var band = backtest && isFiniteNum(backtest.vol_rmse_combined) ? backtest.vol_rmse_combined : 0;
    var reg = regime(pred, cur, rv);

    // The direction edge is reported from what stage 2 actually earned out of
    // sample, never assumed.
    var directionEdge = "unknown";
    var ba = backtest ? backtest.direction_balanced_accuracy : null;
    if (ba != null && isFiniteNum(ba)) {
      directionEdge = ba >= 0.45 ? "usable" : ba >= 0.38 ? "weak" : "none";
    }

    var improve = backtest ? backtest.combined_vs_persistence_pct : NaN;
    var reliable = isFiniteNum(improve) && improve > 5 && backtest.samples >= 200;

    // Data quality.
    var lastGap = null,
      stale = false;
    if (haveTs && n > 3) {
      var diffs = [];
      for (i = 1; i < n; i++) diffs.push((ts[i] - ts[i - 1]) / 1000);
      diffs.sort(function (a, b) { return a - b; });
      var med = quantile(diffs, 0.5);
      var lastSec = (ts[n - 1] - ts[n - 2]) / 1000;
      lastGap = round(lastSec, 1);
      stale = med > 0 && lastSec > Math.max(300, med * 20);
    }
    if (stale)
      warnings.push(
        "The most recent bar is much older than the typical bar spacing; the forecast may be based on a stale feed."
      );
    var sessions = 1;
    for (i = 1; i < n; i++) if (boundary[i]) sessions++;
    if (sessions < 3)
      warnings.push(
        "Fewer than three trading sessions of history: the volatility regime estimate is fragile."
      );

    var ann = function (x) {
      return ppy ? x * Math.sqrt(ppy) : null;
    };

    return {
      symbol: symbol,
      bars: n,
      model: s2 ? MODEL2 : MODEL,
      cached: false,
      engine: s2 ? "browser-js-tfjs" : "browser-js",
      predicted_volatility: round(pred, 5),
      linear_volatility: round(linNext, 5),
      residual_correction: round(residual, 6),
      garch_volatility: isFiniteNum(garch) ? round(garch, 5) : null,
      current_volatility: round(cur, 5),
      vol_percentile: round(pct, 4),
      direction_signal: direction,
      direction_confidence: confidence == null ? null : round(confidence, 4),
      stage2_weight: round(stage2Weight, 4),
      lstm_raw_residual: round(rawResidual, 6),
      vol_low: round(Math.max(0, pred - band), 5),
      vol_high: round(pred + band, 5),
      regime: reg[0],
      regime_reason: reg[1],
      predicted_vol_annual_pct: ppy ? round(ann(pred), 3) : null,
      current_vol_annual_pct: ppy ? round(ann(cur), 3) : null,
      backtest: backtest || {},
      series: series,
      data_quality: { bars: n, sessions: sessions, duplicate_timestamps: 0, stale: stale, last_gap_seconds: lastGap },
      warnings: warnings,
      direction_edge: directionEdge,
      reliable: reliable,
      strict: strict,
    };
  }

  // Stage-1-only fit: the public entry point the page and the parity harness use.
  function run(bars, opts) {
    return finish(buildStage1(bars, opts), null);
  }

  function regime(pred, cur, rv) {
    var pct = mean(rv.map(function (x) { return x <= pred ? 1 : 0; }));
    var sorted = rv.slice().sort(function (a, b) { return a - b; });
    var squeeze = rv.length > 5 ? cur <= quantile(sorted, 0.35) : false;
    if (squeeze && pred > cur * 1.12) {
      return [
        "Breakout Risk",
        "Volatility is in the bottom third of its recent range (" +
          f0(pct * 100) +
          "th pct) but the forecast is rising (" +
          f2(cur) +
          "% -> " +
          f2(pred) +
          "%), the classic squeeze-then-expansion setup.",
      ];
    }
    if (pct >= 0.7 || pred > cur * 1.3) {
      return [
        "High Volatility Expansion",
        "The forecast sits in the " +
          f0(pct * 100) +
          "th percentile of recent realized volatility and is expanding (" +
          f2(cur) +
          "% -> " +
          f2(pred) +
          "%).",
      ];
    }
    return [
      "Low Volatility Ranging",
      "The forecast (" +
        f2(pred) +
        "%) is contained relative to recent realized volatility (" +
        f0(pct * 100) +
        "th percentile); conditions favour range behaviour over expansion.",
    ];
  }

  function round(x, d) {
    if (!isFiniteNum(x)) return null;
    var m = Math.pow(10, d);
    return Math.round(x * m) / m;
  }
  function f2(x) {
    return isFiniteNum(x) ? x.toFixed(2) : "--";
  }
  function f0(x) {
    return isFiniteNum(x) ? x.toFixed(0) : "--";
  }

  var api = {
    run: run,
    buildStage1: buildStage1,
    finish: finish,
    // Stage-2 constants, exported so volmodel2.js and the tests share one source.
    config: {
      lookback: LOOKBACK,
      testFrac: TEST_FRAC,
      dirNeutralQ: DIR_NEUTRAL_Q,
      dirThreshold: DIR_THRESHOLD,
    },
    _internal: { garmanKlass: garmanKlass, harWalkForward: harWalkForward, garchNext: garchNext },
  };
  root.DeskVol = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
