import { useEffect, useState } from "react";
import { Info, TONE } from "@/components/site/bits";
import { INDICATORS, jitterValues } from "@/lib/indicators";

/** Live board of the 14 indicators the desk tracks, each with a tone and a plain English tooltip. */
export const IndicatorBoard = ({ active, onTick }) => {
  const [vals, setVals] = useState(() => INDICATORS.map((i) => i.base));
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setVals((vs) => {
        const next = vs.map((v, i) => jitterValues(INDICATORS[i], v));
        onTick?.(next);
        return next;
      });
    }, 1900);
    return () => clearInterval(id);
  }, [active, onTick]);

  return (
    <div className="glass-inner rounded-2xl p-4" data-testid="indicator-board">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-[12px] text-steel">14 indicators, SPY · 1 min</span>
        <span className="flex items-center gap-2 text-[11px] text-steel"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-mint text-mint" />live</span>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {INDICATORS.map((ind, i) => {
          const tone = TONE[ind.tone(vals[i])];
          return (
            <li key={ind.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 transition-colors duration-500 hover:border-white/[0.12]" data-testid={`indicator-${ind.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-steel">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-500" style={{ background: tone.hex }} />
                  <span className="truncate">{ind.name}</span>
                </span>
                <Info id={`ind-${ind.id}`} text={ind.tip} align={i % 2 === 0 ? "left" : "right"} />
              </div>
              <div className={`num mt-1 text-[13px] ${tone.text}`}><span key={vals[i][0]} className="num-in">{ind.fmt(vals[i])}</span></div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
