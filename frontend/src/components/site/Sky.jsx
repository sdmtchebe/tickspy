import { motion, useScroll, useTransform, useSpring } from "framer-motion";

const STARS = [
  { top: "6%", left: "78%", delay: "0s", dur: "9s", len: 160 },
  { top: "18%", left: "96%", delay: "3.4s", dur: "11s", len: 120 },
  { top: "3%", left: "52%", delay: "6.1s", dur: "10s", len: 200, mint: true },
  { top: "32%", left: "88%", delay: "8.3s", dur: "12s", len: 110 },
  { top: "12%", left: "30%", delay: "2.2s", dur: "13s", len: 140 },
  { top: "44%", left: "70%", delay: "10.7s", dur: "9.5s", len: 180, mint: true },
  { top: "60%", left: "98%", delay: "5.2s", dur: "12.5s", len: 130 },
  { top: "72%", left: "40%", delay: "13.9s", dur: "11.5s", len: 150 },
  { top: "26%", left: "14%", delay: "16.4s", dur: "10.5s", len: 100 },
];

// Candlestick "constellations": each candle is [low, high, open, close] on a 0..100 scale.
const PATTERNS = [
  { name: "three soldiers", c: [[20, 48, 26, 42], [36, 64, 40, 58], [52, 82, 56, 76]] },
  { name: "hammer", c: [[60, 90, 84, 70], [48, 76, 72, 56], [10, 54, 50, 46], [44, 80, 48, 74]] },
  { name: "engulfing", c: [[50, 70, 66, 54], [40, 84, 46, 80]] },
  { name: "doji", c: [[30, 56, 40, 50], [38, 70, 54, 55], [52, 86, 58, 80]] },
  { name: "evening star", c: [[20, 56, 24, 52], [54, 70, 62, 64], [26, 60, 56, 30]] },
  { name: "morning star", c: [[50, 84, 80, 54], [36, 50, 42, 44], [40, 78, 44, 74]] },
];

const PLACE = [
  { top: "14%", left: "6%", s: 1.1, dur: 26, delay: 0, speed: 0.12 },
  { top: "58%", left: "88%", s: 0.9, dur: 31, delay: -8, speed: 0.22 },
  { top: "76%", left: "10%", s: 1.3, dur: 29, delay: -14, speed: 0.08 },
  { top: "30%", left: "60%", s: 0.75, dur: 34, delay: -5, speed: 0.3 },
  { top: "88%", left: "52%", s: 1, dur: 27, delay: -19, speed: 0.16 },
  { top: "6%", left: "40%", s: 0.7, dur: 36, delay: -11, speed: 0.26 },
];

const Candles = ({ c }) => (
  <svg viewBox="0 0 120 100" className="h-[110px] w-[132px]" aria-hidden="true">
    {c.map(([lo, hi, o, cl], i) => {
      const x = 16 + i * 30;
      const up = cl >= o;
      const col = up ? "#00E5A0" : "#FF4D6A";
      return (
        <g key={i}>
          <line x1={x} x2={x} y1={100 - hi} y2={100 - lo} stroke={col} strokeWidth="1.2" />
          <rect x={x - 6} y={100 - Math.max(o, cl)} width="12" height={Math.max(2, Math.abs(cl - o))} rx="1.5" fill={up ? "rgba(0,229,160,0.55)" : "rgba(255,77,106,0.55)"} stroke={col} strokeWidth="1" />
          <circle cx={x} cy={100 - hi} r="1.6" fill="#fff" />
          {i < c.length - 1 && <line x1={x} y1={100 - hi} x2={x + 30} y2={100 - c[i + 1][1]} stroke="rgba(255,255,255,0.35)" strokeWidth="0.6" strokeDasharray="2 3" />}
        </g>
      );
    })}
  </svg>
);

const Constellation = ({ p, pattern, progress, mobileHidden }) => {
  const y = useTransform(progress, [0, 1], [0, -900 * p.speed]);
  return (
    <motion.div className={`absolute ${mobileHidden ? "hidden md:block" : ""}`} style={{ top: p.top, left: p.left, y }}>
      <div className="float-slow" style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s`, transform: `scale(${p.s})` }}>
        <div className="constellation">
          <Candles c={pattern.c} />
          <span className="num mt-1 block text-center text-[9px] uppercase tracking-[0.3em] text-white/40">{pattern.name}</span>
        </div>
      </div>
    </motion.div>
  );
};

export const Sky = () => {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 20 });
  const auroraY = useTransform(progress, [0, 1], [0, -260]);
  const starsY = useTransform(progress, [0, 1], [0, -140]);
  return (
    <div className="sky" aria-hidden="true" data-testid="starry-sky">
      <div className="sky-horizon" />
      <motion.div className="absolute inset-0" style={{ y: auroraY }}>
        <div className="aurora aurora-a" />
        <div className="aurora aurora-b" />
        <div className="aurora aurora-c" />
      </motion.div>
      <motion.div className="absolute inset-0" style={{ y: starsY }}>
        <div className="sky-layer sky-a" />
        <div className="sky-layer sky-b" />
      </motion.div>
      <div className="sky-layer sky-c" />
      <div className="sky-grid" />
      {PLACE.map((p, i) => <Constellation key={i} p={p} pattern={PATTERNS[i % PATTERNS.length]} progress={progress} mobileHidden={i % 2 === 1} />)}
      {STARS.map((s) => (
        <span
          key={s.delay}
          className={`shooting-star ${s.mint ? "shooting-star-mint" : ""}`}
          style={{ top: s.top, left: s.left, width: s.len, animationDelay: s.delay, animationDuration: s.dur }}
        />
      ))}
    </div>
  );
};
