import { useCallback, useState } from "react";
import { CandleChart } from "@/components/site/CandleChart";
import { Num, Spark, scoreTone, TONE } from "@/components/site/bits";
import { fmt } from "@/lib/market";

/*
 * The live demo card. It is the only place on the page that moves on its own,
 * so everything around it stays still: one panel, one recessed chart well, and
 * no decoration competing with the candles.
 */
export const HeroCard = () => {
  const [s, setS] = useState(null);
  const [atrPts, setAtrPts] = useState([]);

  const onUpdate = useCallback((snap) => {
    setS(snap);
    setAtrPts((prev) => [...prev, snap.atr].slice(-48));
  }, []);

  const tone = TONE[scoreTone(s?.score ?? 50)];
  const up = (s?.change ?? 0) >= 0;

  return (
    <div className="panel overflow-hidden" data-testid="hero-mock-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="live-dot" aria-hidden="true" />
          <span className="num text-[13px] font-medium text-ink">SPY</span>
          <span className="text-[12.5px] text-steel">1 min · demo data</span>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 ${tone.border} ${tone.bg}`} data-testid="hero-score-badge">
          <span className={`text-[12px] font-semibold ${tone.text}`}>{tone.label}</span>
          <Num value={s?.score ?? 50} className={`text-[12px] font-semibold ${tone.text}`} />
        </div>
      </div>

      <div className="flex items-end justify-between px-5 pt-5">
        <div>
          <Num value={fmt(s?.price ?? 0)} className="text-[33px] font-medium leading-none text-ink" testId="hero-price" />
          <div className={`num mt-2 text-[13px] ${up ? "text-mint" : "text-bear"}`}>
            {up ? "+" : ""}
            {fmt(s?.change ?? 0)}% today
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-steel">VWAP</div>
          <div className="num mt-0.5 text-[15px] text-amber">{fmt(s?.vwap ?? 0)}</div>
        </div>
      </div>

      <div className="mx-5 mt-5 h-[210px] overflow-hidden rounded-[10px] border border-line bg-well sm:h-[248px]">
        <CandleChart symbol="SPY" vwap onUpdate={onUpdate} interval={700} testId="hero-candle-chart" />
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-5 border-t border-line px-5 py-4">
        <div>
          <div className="text-[12px] text-steel">ATR 14</div>
          <Num value={`$${fmt(s?.atr ?? 0)}`} className="text-[15px] text-ink" testId="hero-atr-value" />
        </div>
        <Spark points={atrPts} />
        <div className="text-right">
          <div className="text-[12px] text-steel">Bollinger %B</div>
          <Num value={fmt(s?.pctB ?? 0.5)} className="text-[15px] text-ink" />
        </div>
      </div>
    </div>
  );
};
