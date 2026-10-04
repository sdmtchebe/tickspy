# Volatility engine — backtest record

What follows is measured, not claimed. Every number comes from running the
shipped engine (`desk/volmodel.js`) over real Alpaca bars.

Reproduce it:

```bash
# cached bars are reused; set the keys to fetch and cache fresh ones
export ALPACA_KEY_ID=... ALPACA_SECRET_KEY=...
node desk/tests/volmodel_backtest.js
```

Default sample: **SPY, 5-minute bars, 2021-10-05 → 2026-10-02, 105,085 bars**
(Alpaca IEX, the free feed's full history). Override with `BT_SYMBOL`, `BT_TF`,
`BT_START`.

## Method

1. **Expanding-window folds.** The engine trains on the first 80% of a slice and
   tests on the held-out last 20%. The harness re-runs the whole engine at seven
   cutoffs (40% → 100% of the sample) so a single lucky window cannot flatter it.
   Inside each fold the HAR fit is itself an expanding walk-forward, so every
   one-step estimate is genuinely out of sample.
2. **Skill against a naive baseline.** The comparison is persistence — "the next
   bar's volatility equals the last one's". A model that cannot beat that has no
   edge, however good its R² looks.
3. **Regime tranches.** The final fold's test window is split into calm / mid /
   turbulent thirds by realized volatility.
4. **Look-ahead integrity test.** The newest 25 bars are rewritten (open, high,
   low, close and volume) and the engine is re-run. Estimates it made for older,
   untouched bars must be bit-identical. If rewriting the future changes the
   past, the model is peeking. This is the one pass/fail assertion in the file.

## Results (SPY, 5-minute, 5 years, 7 folds)

| OOS bars | RMSE estimate | RMSE persistence | skill vs persistence | R² | MZ slope | reliable |
|---------:|--------------:|-----------------:|---------------------:|---:|---------:|:--------:|
| 5,380 | 0.0223 | 0.0251 | +10.8% | 0.374 | 0.457 | yes |
| 6,668 | 0.0236 | 0.0279 | +15.6% | 0.316 | 1.055 | yes |
| 7,948 | 0.0255 | 0.0301 | +15.5% | 0.379 | 0.422 | yes |
| 9,236 | 0.0401 | 0.0465 | +13.7% | 0.639 | 0.925 | yes |
| 10,548 | 0.0393 | 0.0454 | +13.5% | 0.639 | 0.834 | yes |
| 11,915 | 0.0242 | 0.0281 | +13.8% | 0.516 | 0.862 | yes |
| 13,245 | 0.0288 | 0.0345 | +16.5% | 0.407 | 0.754 | yes |

- **Skill vs persistence: +10.8% … +16.5% RMSE improvement, positive in 7/7 folds.**
- **R² 0.32 … 0.64, positive in 7/7 folds.**
- By regime (final fold): calm **+8.0%**, mid **+25.2%**, turbulent **+32.4%**.
- **Look-ahead: none found.** Rewriting the newest 25 bars left all 135 older
  estimates unchanged.

## What this does and does not establish

Establishes: out of sample, on five years of real intraday bars, the estimate
beats the naive baseline in every fold tested, and it does not use future data.
The reliability flag is not decoration — it fired in 7/7 folds and every fold
genuinely cleared the >5% threshold.

Does **not** establish, and the UI must not imply:

- **Calibration is imperfect.** The Mincer-Zarnowitz slope (realized regressed on
  the estimate) ranges 0.42–1.06 with a median of 0.83. Below 1 means the
  estimate is under-dispersed — too smooth, too timid about extremes. The
  *relative* ranking of calm vs turbulent bars is more trustworthy than the
  absolute level. Say so; do not present the number as a precise level.
- **Skill concentrates in busy markets.** Only +8.0% in the calmest third. On a
  quiet tape the estimate is barely better than "same as last bar".
- **Stage 2 contributes nothing in the shipped build.** In the browser/Node
  stage-1 path the LSTM never runs, so `combined` equals `linear` and
  "skill vs stage-1 linear" is exactly 0%. Any headline that calls the output a
  "combined" estimate should say it is HAR-only unless the LSTM actually ran.
- **One instrument, one time frame.** SPY only, 5-minute only. No claim carries
  to other tickers or to 1-minute bars.
- **No costs, and no position.** This estimates volatility; it never trades, so
  there is nothing to charge. But volatility clustering also means the sample is
  not independent, which makes the errors above optimistic in the usual way.

## Known engine limitations found while testing

- **Daily bars cannot be backtested.** `toCleanBars` converts `t` to a
  millisecond number, so every daily bar looks like a new ET session, the entire
  return series is masked as overnight gaps, and no out-of-sample window
  survives. The engine emits *"Not enough clean out-of-sample bars for a
  backtest"* and reports no metrics rather than inventing any — correct
  behaviour, and worth keeping. It does mean the Backtest panel is silently
  empty for daily data.
- **GARCH(1,1) frequently fails to converge** on daily bars and the engine says
  so ("GARCH did not converge; using HAR only") instead of reporting a
  meaningless number. On 5-minute data it converges.

---

# Confidence labels — backtest record

```bash
node desk/tests/score_backtest.js /tmp/bt_SPY_5Min.json
```

This one runs the desk's **own** `analyze()` in Chrome, once per bar, over the
same five years of SPY 5-minute bars (5,239 evaluations, stride 20, trailing
300-bar window), and scores the labels the UI shows against moves the scorer
never saw. Nothing is re-implemented.

## 1. The 0–100 score does not predict direction

| score bucket | n | mean forward return (12 bars) | up-rate |
|---|---:|---:|---:|
| 20–39 | 866 | +0.011% | 52.4% |
| 40–59 | 3,287 | +0.002% | 51.8% |
| 60–79 | 1,085 | +0.006% | 55.2% |
| 80–100 | 1 | +0.062% | 100% |

- "Bullish" (≥60): mean **+0.007%**, up-rate **55.2%**
- "Bearish" (≤40): mean **+0.004%**, up-rate **51.7%**
- All bars: mean +0.005%, up-rate 52.6%
- **Spread (Bullish − Bearish) = +0.002% per 12 bars.**

A positive mean on the *bearish* bucket and a two-thousandths-of-a-percent
spread means the score carries no usable directional edge on this sample. It is
a description of the indicator readings right now, not a forecast of the next
move. The wording was changed accordingly: the pill now reads "Bullish
readings" / "Bearish readings" / "Mixed readings", and its explanation states
the measured result rather than implying an edge.

## 2. The big-move label is real, but two of its names were wrong

Top third of |12-bar moves| = anything beyond 0.249%. Base rate 33.3%.

| count | OLD label | NEW label | n | P(big move) | mean range |
|---|---|---|---:|---:|---:|
| 0 | Low | Quiet | 1,792 | 20.7% | 0.319% |
| 1 | **Low** | Normal | 2,586 | **35.3%** | 0.467% |
| 2 | Medium | Elevated | 814 | 53.1% | 0.698% |
| 3 | High | High | 47 | 61.7% | 0.799% |

- The ordering is genuine and monotonic: **20.7% → 35.3% → 53.1% → 61.7%**
  against a 33.3% base rate. Low vs Medium+High is 20.7% vs 53.5%.
- **The defect was the naming.** `['Low','Low','Medium','High']` labelled the
  middle band "Low" when a big move followed it *more* often than average
  (35.3% > 33.3%). Two of four bands sharing the name "Low", one of them above
  base rate, overstates the quiet case.
- Fixed to a monotonic four-band scale (Quiet / Normal / Elevated / High), and
  "Chance of a big move" was renamed "Big-move conditions", because these are
  ordered bands from a count of three conditions, not calibrated probabilities.

## Still outstanding on the confidence labels

- No significance testing yet (a bootstrap or block-permutation test would put
  error bars on the 55.2% vs 51.7% up-rate difference).
- Stride 20 means overlapping horizons, so the effective sample is far smaller
  than 5,239 and the intervals above are narrower than they look.
- Only SPY and 5-minute bars; the pattern and multi-timeframe overlays are
  reported but not separately scored.
