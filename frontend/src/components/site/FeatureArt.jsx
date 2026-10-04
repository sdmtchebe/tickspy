import { useEffect, useState } from "react";

const useTick = (ms) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
};

const QUOTES = [["SPY", 548.32], ["QQQ", 474.9], ["AAPL", 226.14], ["NVDA", 128.56]];

export const PricesArt = () => {
  const n = useTick(1100);
  const [rows, setRows] = useState(QUOTES.map(([t, p]) => ({ t, p, d: 0 })));
  useEffect(() => {
    if (n === 0) return;
    setRows((r) => r.map((x) => { const d = (Math.random() - 0.48) * x.p * 0.0012; return { ...x, p: x.p + d, d }; }));
  }, [n]);
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-2">
      {rows.map((r) => (
        <div key={r.t} className="flex items-center justify-between rounded-lg bg-white/[0.025] px-4 py-2">
          <span className="font-display text-[13px] font-semibold text-ink">{r.t}</span>
          <span className={`num text-[13px] transition-colors duration-500 ${r.d >= 0 ? "text-mint" : "text-bear"}`}>
            <span key={r.p} className="num-in">{r.p.toFixed(2)}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

const CANDLES = [[30, 70, 40, 62, 1], [52, 84, 58, 78, 1], [70, 96, 74, 92, 1], [84, 110, 88, 104, 1], [98, 118, 100, 112, 1]];

export const PatternArt = () => (
  <svg viewBox="0 0 300 160" className="h-full w-full" aria-hidden="true">
    {CANDLES.map(([lo, hi, o, c], i) => {
      const x = 30 + i * 40;
      return (
        <g key={x}>
          <line x1={x + 8} x2={x + 8} y1={160 - hi} y2={160 - lo} stroke="#00E5A0" strokeWidth="1.5" opacity="0.7" />
          <rect x={x} y={160 - c} width="16" height={c - o} rx="2" fill="#00E5A0" opacity="0.75" />
        </g>
      );
    })}
    <g>
      <line x1="238" x2="238" y1="12" y2="44" stroke="#FF4D6A" strokeWidth="1.5" className="grow-wick" style={{ transformBox: "fill-box" }} />
      <rect x="230" y="44" width="16" height="9" rx="2" fill="#FF4D6A" />
      <line x1="238" x2="238" y1="53" y2="58" stroke="#FF4D6A" strokeWidth="1.5" />
    </g>
    <g className="lock-on" stroke="#E8ECF4" strokeWidth="1.5" fill="none">
      <path d="M216 8h-6v8M260 8h6v8M216 66h-6v-8M260 66h6v-8" />
    </g>
    <g className="lock-on">
      <rect x="150" y="78" width="132" height="24" rx="12" fill="rgba(255,77,106,0.12)" stroke="rgba(255,77,106,0.4)" />
      <text x="216" y="94" textAnchor="middle" fill="#FF4D6A" fontSize="11" fontFamily="DM Sans" fontWeight="600">Shooting star found</text>
    </g>
  </svg>
);

const SCORES = [68, 74, 57, 81, 63];

export const ScoreArt = () => {
  const n = useTick(1800);
  const s = SCORES[n % SCORES.length];
  const tone = s >= 60 ? "#00E5A0" : s <= 40 ? "#FF4D6A" : "#FFB347";
  return (
    <div className="relative flex h-full items-end justify-center">
      <svg viewBox="0 0 200 110" className="h-[140px] w-auto" aria-hidden="true">
        <path d="M20 100a80 80 0 0 1 160 0" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
        <path d="M20 100a80 80 0 0 1 53-75" fill="none" stroke="#FF4D6A" strokeWidth="10" strokeLinecap="round" opacity="0.6" />
        <path d="M127 25a80 80 0 0 1 53 75" fill="none" stroke="#00E5A0" strokeWidth="10" strokeLinecap="round" opacity="0.6" />
        <g style={{ transform: `rotate(${(s / 100) * 180 - 90}deg)`, transformOrigin: "100px 100px", transition: "transform 900ms cubic-bezier(0.22,1,0.36,1)" }}>
          <line x1="100" y1="100" x2="100" y2="34" stroke="#E8ECF4" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="6" fill="#E8ECF4" />
      </svg>
      <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center">
        <span className="num text-[22px] font-medium" style={{ color: tone }}><span key={s} className="num-in">{s}</span></span>
      </div>
    </div>
  );
};

const WAVE = "M0 60 C 25 20, 50 20, 75 60 S 125 100, 150 60 S 200 20, 225 60 S 275 100, 300 60 S 350 20, 375 60 S 425 100, 450 60 S 500 20, 525 60 S 575 100, 600 60";

export const VolatilityArt = () => (
  <div className="flex h-full flex-col justify-between">
    <div className="relative h-[96px] overflow-hidden">
      <svg viewBox="0 0 600 120" preserveAspectRatio="none" className="wave-move absolute inset-y-0 left-0 h-full w-[200%]" aria-hidden="true">
        <path d={WAVE} fill="none" stroke="#FFB347" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={WAVE} fill="none" stroke="rgba(232,236,244,0.25)" strokeWidth="1" transform="translate(0 -26)" vectorEffect="non-scaling-stroke" />
        <path d={WAVE} fill="none" stroke="rgba(232,236,244,0.25)" strokeWidth="1" transform="translate(0 26)" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {[["ATR 14", "$2.34"], ["VWAP", "547.90"], ["%B", "0.71"]].map(([k, v]) => (
        <div key={k} className="rounded-lg bg-white/[0.025] px-3 py-2">
          <div className="text-[12px] text-steel">{k}</div>
          <div className="num text-[13px] text-ink">{v}</div>
        </div>
      ))}
    </div>
  </div>
);

const NEWS = [
  ["NVDA", "Supplier guidance beats estimates", "Demand for AI chips still rising"],
  ["SPY", "Treasury yields slip after auction", "Lower rates usually help stocks"],
  ["AAPL", "New iPhone shipments run ahead", "Sales tracking above last year"],
  ["TSLA", "Delivery numbers miss forecasts", "Weaker quarter than expected"],
];

export const NewsArt = () => (
  <div className="relative h-full overflow-hidden [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]">
    <div className="scroll-y">
      {[...NEWS, ...NEWS].map(([t, h, a], i) => (
        <div key={i} className="mb-2 rounded-lg bg-white/[0.025] px-4 py-3">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="num font-semibold text-ink">{t}</span>
            <span className="text-steel">{h}</span>
          </div>
          <div className="mt-1 text-[12px] text-mint">AI summary: {a}</div>
        </div>
      ))}
    </div>
  </div>
);

const EVENTS = [["08:30", "CPI inflation report", "High"], ["10:00", "Consumer sentiment", "Med"], ["14:00", "Fed rate decision", "High"]];

export const CalendarArt = () => (
  <div className="flex h-full flex-col justify-center gap-2">
    {EVENTS.map(([t, e, imp], i) => (
      <div key={t} className={`flex items-center gap-4 rounded-lg px-4 py-2 ${i === 0 ? "border border-amber/30 bg-amber/[0.06]" : "bg-white/[0.025]"}`}>
        <span className="num text-[13px] text-ink">{t}</span>
        <span className="flex-1 text-[13px] text-ink">{e}</span>
        {i === 0 ? (
          <span className="flex items-center gap-2 text-[12px] font-semibold text-amber">
            <svg viewBox="0 0 16 16" className="blink-amber h-3.5 w-3.5" aria-hidden="true"><path d="M8 2a4 4 0 0 0-4 4v3l-1.5 2h11L12 9V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            in 12 min
          </span>
        ) : (
          <span className="text-[12px] text-steel">{imp}</span>
        )}
      </div>
    ))}
  </div>
);
