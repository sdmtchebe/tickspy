import { useEffect, useRef, useState } from "react";

const STAGES = [
  { stage: 1, items: ["Garman-Klass RV", "HAR(1,5,22) walk-forward", "GARCH(1,1) cross-check", "Residuals e_t"] },
  { stage: 2, items: ["RobustScaler · lookback 30", "LSTM 2×64 · dropout 0.2", "Residual Δ + 3 direction logits", "Auto-gate · OOS RMSE"] },
];

/**
 * Animated pipeline diagram. A pulse walks through stage 1 then stage 2.
 *
 * The travelling highlight is expressed as a border and a fill change only.
 * It used to also drag a mint dot with it and paint a translucent wash under
 * the active box, which made a diagram about a model look like a light show.
 */
export const VolPipeline = ({ active }) => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setStep((s) => (s + 1) % 8), 800);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="vol-pipeline">
      {STAGES.map(({ stage, items }, si) => {
        const stageOn = Math.floor(step / 4) === si;
        return (
          <div key={stage} className={`well p-4 transition-colors duration-300 ${stageOn ? "border-mint/30" : ""}`}>
            <div className="mb-3 flex items-center gap-3">
              <span className={`num text-[11px] tracking-[0.08em] ${stageOn ? "text-mint" : "text-steel"}`}>Stage {stage}</span>
              <span className="text-[12px] text-steel">{stage === 1 ? "Statistical filter" : "LSTM correction"}</span>
            </div>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {items.map((it, i) => {
                const on = step === si * 4 + i;
                return (
                  <li
                    key={it}
                    className={`flex h-full items-center rounded-lg border px-3 py-2.5 text-[12px] leading-snug transition-colors duration-300 ${
                      on ? "border-mint/50 bg-surface2 text-ink" : "border-line bg-surface text-steel"
                    }`}
                  >
                    {it}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
};

const PAD = { l: 8, r: 64, t: 14, b: 22 };

const path = (arr, x, y, offset = 0) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i + offset).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

const useSize = () => {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 640, h: 220 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(180, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
};

/** Realized vol vs HAR linear forecast vs LSTM-corrected forecast with uncertainty band. */
export const VolForecastChart = ({ m }) => {
  const [ref, { w: W, h: H }] = useSize();
  if (!m) return <div ref={ref} className="min-h-[220px] flex-1" />;
  const { rv, har, corrected, rmse, forecast, linear } = m;
  const off = rv.length - har.length; // forecasts start after the 22-bar warm-up
  const all = [...rv, ...har, ...corrected, forecast + rmse, forecast - rmse];
  const lo = Math.min(...all) * 0.92;
  const hi = Math.max(...all) * 1.06;
  const n = rv.length; // index n is the next-bar forecast
  const x = (i) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
  const band = [...corrected, forecast];
  const upper = band.map((v) => v + rmse);
  const lower = band.map((v) => v - rmse);
  const bandPath = `${path(upper, x, y, off)} ${[...lower].reverse().map((v, i) => `L${x(lower.length - 1 - i + off).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} Z`;
  return (
    <div ref={ref} className="relative min-h-[220px] w-full flex-1" data-testid="vol-forecast-chart">
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0" aria-label="Volatility estimate chart">
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke="rgba(255,255,255,0.05)" />)}
      <path d={bandPath} fill="rgba(0,229,160,0.10)" />
      <path d={path(rv, x, y)} fill="none" stroke="rgba(232,236,244,0.85)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={path([...har, linear], x, y, off)} fill="none" stroke="#FFB347" strokeWidth="1.3" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={path(band, x, y, off)} fill="none" stroke="#00E5A0" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1={x(n - 1)} x2={x(n - 1)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(0,229,160,0.3)" strokeDasharray="2 4" />
      <circle cx={x(n)} cy={y(forecast)} r="4" fill="#00E5A0" />
      <text x={x(n) + 8} y={y(forecast) + 4} fill="#00E5A0" fontSize="11" fontFamily="JetBrains Mono">{`${forecast.toFixed(2)}%`}</text>
      <text x={x(n) + 8} y={y(linear) + 4 + (Math.abs(y(linear) - y(forecast)) < 12 ? 14 : 0)} fill="#FFB347" fontSize="10" fontFamily="JetBrains Mono">{`${linear.toFixed(2)}%`}</text>
      <text x={PAD.l} y={H - 6} fill="#9AA3B2" fontSize="10" fontFamily="JetBrains Mono">{`t-${n - 1}`}</text>
      <text x={x(n - 1) - 4} y={H - 6} fill="#9AA3B2" fontSize="10" fontFamily="JetBrains Mono" textAnchor="end">now</text>
      <text x={x(n)} y={H - 6} fill="#00E5A0" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">t+1</text>
    </svg>
    </div>
  );
};
