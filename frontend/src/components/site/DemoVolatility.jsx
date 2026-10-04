import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Num, Info, TONE } from "@/components/site/bits";
import { VolPipeline, VolForecastChart } from "@/components/site/VolPipeline";
import { createVolModel, STAGE2_FULL_IMPROVE } from "@/lib/volmodel";

const DIR = [["Bearish", "bear"], ["Neutral", "warn"], ["Bullish", "bull"]];

const Row = ({ k, v, c = "text-ink", id, tip }) => (
  <div className="flex items-center justify-between gap-3 py-2" data-testid={`vol-row-${id}`}>
    <span className="flex items-center gap-2 text-[13px] text-steel">{k}{tip && <Info id={`vol-${id}`} text={tip} align="left" />}</span>
    <Num value={v} className={`text-[14px] ${c}`} />
  </div>
);

export const DemoVolatility = ({ active }) => {
  const model = useMemo(() => createVolModel(), []);
  const [m, setM] = useState(() => model.step());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setM(model.step()), 1600);
    return () => clearInterval(id);
  }, [active, model]);

  const sign = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;
  const dirIdx = m.probs.indexOf(Math.max(...m.probs));
  const regime = m.forecast > 1.15 ? "bear" : m.forecast > 0.95 ? "warn" : "bull";
  const regimeText = { bear: "Elevated", warn: "Normal", bull: "Calm" }[regime];

  return (
    <div className="flex flex-col gap-4">
      {/* The values on this panel are generated in the browser (see lib/volmodel),
          not computed from live data. Saying so is the whole point: the real
          engine, and its measured backtest, live in the desk. */}
      <p className="text-[12px] leading-relaxed text-steel">
        <span className="font-medium text-mint">Illustrative simulation.</span> These figures are generated in the browser to show the shape of the pipeline. They are not a live model run on real bars — open the desk for the real engine, which is backtested against years of market history.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="glass-inner flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-8" data-testid="vol-chart-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[12px] text-steel">Realized volatility, next-bar estimate</div>
              <div className="font-display text-[18px] font-semibold text-ink">Two-stage model, out-of-sample</div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-steel">
              <span className="flex items-center gap-2"><span className="h-px w-4 bg-ink/80" />Garman-Klass RV</span>
              <span className="flex items-center gap-2"><span className="h-px w-4 border-t border-dashed border-amber" />HAR linear</span>
              <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-mint" />LSTM corrected</span>
              <span className="flex items-center gap-2"><span className="h-3 w-4 rounded-sm bg-mint/20" />±OOS RMSE</span>
            </div>
          </div>
          <VolForecastChart m={m} />
        </div>

        <div className="glass-inner flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-4" data-testid="vol-readout-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[12px] text-steel">Estimated RV, t+1</div>
              <Num value={`${m.forecast.toFixed(2)}%`} className={`text-[32px] font-medium leading-none ${TONE[regime].text}`} testId="vol-forecast-value" />
              <div className="num mt-1 text-[12px] text-steel">± {m.rmse.toFixed(2)}% band</div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${TONE[regime].border} ${TONE[regime].bg} ${TONE[regime].text}`} data-testid="vol-regime">{regimeText}</span>
          </div>
          <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            <Row id="linear" k="HAR(1,5,22) linear" v={`${m.linear.toFixed(3)}%`} c="text-amber" tip="Stage 1 estimate. Heterogeneous autoregression on the 1, 5 and 22 bar realized vol, refit with an expanding window so every estimate is out-of-sample." />
            <Row id="garch" k="GARCH(1,1) check" v={`${m.garch.toFixed(3)}%`} tip="A second, independent volatility model on log returns. If it disagrees sharply with HAR, the desk flags it." />
            <Row id="delta" k="LSTM correction Δ" v={sign(m.delta)} c={m.delta >= 0 ? "text-bear" : "text-mint"} tip="Stage 2 output. A 2x64 LSTM predicts the HAR residual from [residual, ATR%, return, relative volume, volume z]. Capped at ±50% of the linear estimate." />
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-2 text-steel">LSTM gate <Info id="vol-gate" text={`The correction is scaled by its out-of-sample RMSE gain. Full weight at ${STAGE2_FULL_IMPROVE.toFixed(1)}% improvement, zero if it does not beat the linear model.`} align="left" /></span>
              <span className="num text-ink" data-testid="vol-gate-value">{(m.gate * 100).toFixed(0)}% · OOS gain {m.oosGain.toFixed(1)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div className="h-full rounded-full bg-mint" animate={{ width: `${m.gate * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 text-[12px] text-steel">Direction head (softmax)</div>
            <div className="grid grid-cols-3 gap-2" data-testid="vol-direction">
              {DIR.map(([label, tone], i) => (
                <div key={label} className={`rounded-xl border p-2.5 transition-colors duration-500 ${i === dirIdx ? TONE[tone].border : "border-white/[0.06]"}`}>
                  <div className="h-10 w-full overflow-hidden rounded-md bg-white/[0.04]">
                    <motion.div className="h-full w-full origin-bottom" style={{ background: TONE[tone].hex, opacity: 0.8 }} animate={{ scaleY: m.probs[i] }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                  <div className={`num mt-1.5 text-[12px] ${i === dirIdx ? TONE[tone].text : "text-steel"}`}>{Math.round(m.probs[i] * 100)}%</div>
                  <div className="text-[11px] text-steel">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-5 space-y-1.5 text-[12px] text-steel" data-testid="vol-checks">
            <li className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${m.masked ? "bg-amber" : "bg-mint"}`} />Session boundary {m.masked ? "masked this bar" : "clear"}</li>
            <li className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${m.quality ? "bg-mint" : "bg-bear"}`} />Data quality {m.quality ? "passed" : "flagged"}</li>
            <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-mint" />Hold-out: chronological, 3-fold expanding walk-forward</li>
          </ul>
        </div>
      </div>
      <VolPipeline active={active} />
    </div>
  );
};
