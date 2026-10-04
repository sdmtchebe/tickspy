import { useCallback, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { CandleChart } from "@/components/site/CandleChart";
import { Num, Spark, scoreTone, TONE } from "@/components/site/bits";
import { fmt } from "@/lib/market";

const Corner = ({ pos }) => {
  const map = {
    tl: "-left-3 -top-3 border-l-2 border-t-2 rounded-tl-md",
    tr: "-right-3 -top-3 border-r-2 border-t-2 rounded-tr-md",
    bl: "-left-3 -bottom-3 border-l-2 border-b-2 rounded-bl-md",
    br: "-right-3 -bottom-3 border-r-2 border-b-2 rounded-br-md",
  };
  return <span className={`reticle-corner ${map[pos]}`} />;
};

export const HeroCard = () => {
  const [s, setS] = useState(null);
  const atrHist = useRef([]);
  const [atrPts, setAtrPts] = useState([]);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 120, damping: 18 });

  const onUpdate = useCallback((snap) => {
    setS(snap);
    atrHist.current = [...atrHist.current, snap.atr].slice(-48);
    setAtrPts(atrHist.current);
  }, []);

  const onMove = (e) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const reset = () => { mx.set(0); my.set(0); };

  const tone = TONE[scoreTone(s?.score ?? 50)];
  const up = (s?.change ?? 0) >= 0;

  return (
    <div className="relative [perspective:1400px]" onPointerMove={onMove} onPointerLeave={reset}>
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }} className="relative" data-testid="hero-mock-card">
        <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
        <div className="glass glass-dense overflow-hidden rounded-[24px] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
          <div className="flex items-center justify-between border-b hairline px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="pulse-dot h-2 w-2 rounded-full bg-mint text-mint" />
              <span className="num text-[13px] font-semibold text-ink">SPY</span>
              <span className="text-[12px] text-steel">1 min · Demo feed</span>
            </div>
            <div className={`badge-pulse flex items-center gap-2 rounded-full border px-3 py-1 ${tone.border} ${tone.bg}`} data-testid="hero-score-badge">
              <span className={`text-[12px] font-semibold ${tone.text}`}>{tone.label}</span>
              <Num value={s?.score ?? 50} className={`text-[12px] font-semibold ${tone.text}`} />
            </div>
          </div>
          <div className="flex items-end justify-between px-5 pt-5">
            <div>
              <Num value={fmt(s?.price ?? 0)} className="text-[34px] font-medium leading-none text-ink" testId="hero-price" />
              <div className={`num mt-2 text-[13px] ${up ? "text-mint" : "text-bear"}`}>
                {up ? "+" : ""}{fmt(s?.change ?? 0)}% today
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] text-steel">VWAP</div>
              <div className="num text-[15px] text-amber">{fmt(s?.vwap ?? 0)}</div>
            </div>
          </div>
          <div className="h-[220px] px-1 sm:h-[260px]">
            <CandleChart symbol="SPY" vwap onUpdate={onUpdate} interval={700} testId="hero-candle-chart" />
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-t hairline px-5 py-4">
            <div>
              <div className="text-[12px] text-steel">ATR 14</div>
              <Num value={`$${fmt(s?.atr ?? 0)}`} className="text-[15px] text-ink" testId="hero-atr-value" />
            </div>
            <Spark points={atrPts} />
            <div className="text-right">
              <div className="text-[12px] text-steel">Boll %B</div>
              <Num value={fmt(s?.pctB ?? 0.5)} className="text-[15px] text-ink" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
