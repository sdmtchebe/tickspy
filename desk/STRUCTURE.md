# Market Structure integration

Open the dedicated **Market Structure** tab in the desk (next to Overview). It follows the selected symbol/timeframe and the free replay cutoff. The separate `Desktop/TickSPY-Structure-Lab` remains a synthetic-data sandbox.

## Modules

- `structure-engine.js`: pure calculations; browser global `DeskStructure` and CommonJS exports for tests.
- `structure-view.js`: local UI, explanatory `?` disclosures, settings, chart and table. No network or credential access.
- `structure.css`: styles scoped to `#structure`.
- `structure-chart.js`: time zoom (wheel/buttons), horizontal/vertical dragging, independent price scaling, cursor crosshair with OHLCV/price, and keyboard/touch inspection. Buttons provide alternatives to dragging. Panning changes the visible chart only; the models and zones continue describing the latest completed bar. Reset follows the latest bars again. Changing symbol, timeframe or mode resets the view.
- `index.html`: calls `structureRefresh()` on each existing desk refresh.

The four engines are the prototype's ADX/efficiency regime rules, Bollinger/Keltner compression scan, delayed pivot clustering with anchored average price, and adaptive CUSUM. Full formulas, thresholds and examples are in the UI under **How to read this • examples and math**. Thresholds are not calibrated probabilities. No profitable strategy or statistical accuracy has been demonstrated.

## Data lifecycle

- Fetches create new `S.bars` arrays. The integration captures a separate shallow copy of the scalar OHLCV values on each array replacement.
- The live trade stream mutates its display candle, but these edits never alter the structure snapshot. The next REST fetch refreshes the snapshot and incorporates provider corrections.
- Live calculations exclude bars whose start plus selected interval is later than the current time. This is an interval-completion filter, not a guarantee that the provider has finalized all corrections.
- Free 5-minute calculations apply the completion filter to the replay timestamp, even if the existing replay helper has returned extra bars as a fallback. Free 15-minute calculations combine **three consecutive completed 5-minute bars** per quarter-hour; incomplete or gapped groups are skipped. No future bars are substituted to meet warmup.
- Free daily analysis uses the separate daily series through the completed `sessionDate`, rather than mislabeling the 5-minute series as daily. Data provenance and daily aggregation correctness require source validation; the panel explicitly warns that bundled free data may contain generated examples.
- The manual HF downloader and Netlify refresh now share `frontend/scripts/hfdata-bars.js`. It uses New York local time (including DST) to select completed regular sessions, groups source intraday bars into true 5-minute OHLCV, and aggregates genuine whole-session daily OHLCV. Sparse minutes are not filled with invented trades. Unit tests use deterministic data; no HF key or authenticated Alpaca account was available for an end-to-end provider test.
- The currently committed bundles are **generated demonstrations**, now explicitly marked `source: mock`. They prove the UI/code path works across the ten supplied names; they are not real price history or evidence that an actual provider account is configured. Missing keyless symbols display an unavailable state. Alpaca mode depends on the user's provider access, chosen feed and available bar count.
- At least 77 valid completed bars are required (50 preceding rank observations after the 26-bar indicator warmup). Missing history yields an explanatory state, not synthetic results. Invalid OHLCV/order yields an error. A symbol/timeframe reset clears old outputs.
- Pivots wait for 3, 5 or 8 subsequent completed bars. Rank reference samples exclude the current observation. The chart shows at most 100 bars; level detection uses up to 240, and the anchored average uses up to 120.
- Recomputations are skipped when bars, selection and parameters are unchanged. Open help disclosures survive recalculation.

No additional subscriptions, APIs or server keys were added. Market Structure has its own navigation tab; Tools retains the existing calculators and scanner. Replay JSON URLs are resolved relative to the loaded freesrc.js, supporting both root hosting and GitHub Pages subfolders.

## Checks

```sh
node --test desk/tests/structure.cjs
```

The frontend production build copies the three assets through `scripts/sync-desk.js`. Existing `launch-check.cjs` now verifies all four panels, keyboard help, live snapshot isolation, parameter changes, replay cutoff, mobile widths and stale-result clearing. `security-check.cjs` validates the packaged artifacts under the existing CSP.

Additional browser checks exercise all ten bundled symbols in 5-minute, 15-minute and daily keyless views; simulated Alpaca HTTP responses exercise AAPL, NVDA, AMD and BRK.B at 1/5/15 minutes, plus insufficient history, a current unfinished bar and an unavailable ticker. These are integration fixtures, **not** a live Alpaca authentication or a real HF download. `node --test frontend/scripts/hfdata-bars.test.cjs` checks DST-sensitive intraday/daily aggregation and exclusion of an unfinished session.

Before promoting these experimental readings as statistically validated, test real licensed history across multiple symbols/timeframes, session boundaries, corporate actions and missing bars. The code does not implement session-specific levels, true volume-at-price or predictive probabilities.
