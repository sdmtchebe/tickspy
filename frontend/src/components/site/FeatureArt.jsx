/*
 * Artwork for the capabilities section.
 *
 * Two shapes only: one larger chart for the lead feature, and five compact
 * 48pt marks for the rows beneath it. Everything here is static SVG. The
 * earlier version of this file animated reticle brackets, growing wicks, a
 * blinking bell, a looping wave and a scrolling headline column, using classes
 * (`.lock-on`, `.grow-wick`, `.blink-amber`, `.wave-move`, `.scroll-y`) that no
 * longer exist — and none of that motion was saying anything the copy was not
 * already saying in words.
 *
 * Nothing here carries a number. The chart shows the shape of a price series
 * and the marks are diagrams, so no figure on this page can be mistaken for a
 * real quote.
 */

const MINT = "#00E5A0";
const BEAR = "#FF4D6A";
const AMBER = "#FFB347";

/* ------------------------------------------------------------ lead art ---- */

/* [open, high, low, close] on a 0-100 logical scale. */
const CANDLES = [
  [30, 44, 26, 40],
  [40, 48, 34, 36],
  [36, 56, 33, 52],
  [52, 60, 46, 50],
  [50, 64, 47, 62],
  [62, 72, 58, 64],
  [64, 70, 56, 58],
  [58, 76, 55, 74],
  [74, 80, 68, 70],
  [70, 86, 67, 83],
  [83, 88, 76, 78],
  [78, 92, 74, 88],
];

const VWAP = [32, 34, 37, 40, 43, 47, 50, 54, 58, 62, 66, 70];

const X0 = 26;
const X1 = 300;
const Y_TOP = 16;
const Y_BOTTOM = 172;
const step = (X1 - X0) / CANDLES.length;
const cx = (i) => X0 + step * i + step / 2;
const cy = (v) => Y_BOTTOM - (v / 100) * (Y_BOTTOM - Y_TOP);

export const PricesArt = () => (
  <svg viewBox="0 0 340 200" className="w-full" role="img" aria-label="A simulated candlestick chart with a VWAP line">
    {/* price grid */}
    {[0, 1, 2, 3].map((k) => (
      <line
        key={k}
        x1={X0}
        x2={X1}
        y1={Y_TOP + (k * (Y_BOTTOM - Y_TOP)) / 3}
        y2={Y_TOP + (k * (Y_BOTTOM - Y_TOP)) / 3}
        stroke="rgba(255,255,255,0.05)"
        strokeWidth="1"
      />
    ))}

    {/* VWAP */}
    <path
      d={VWAP.map((v, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)} ${cy(v).toFixed(1)}`).join(" ")}
      fill="none"
      stroke={AMBER}
      strokeWidth="1.6"
      strokeDasharray="5 4"
    />

    {/* candles */}
    {CANDLES.map(([o, h, l, c], i) => {
      const up = c >= o;
      const colour = up ? MINT : BEAR;
      const top = Math.min(cy(o), cy(c));
      const body = Math.max(2, Math.abs(cy(o) - cy(c)));
      return (
        <g key={i}>
          <line x1={cx(i)} x2={cx(i)} y1={cy(h)} y2={cy(l)} stroke={colour} strokeWidth="1.2" opacity="0.85" />
          <rect x={cx(i) - 5} y={top} width="10" height={body} rx="1.5" fill={colour} opacity="0.75" />
        </g>
      );
    })}

    {/* last close marker, deliberately unlabelled */}
    <line x1={X0} x2={X1} y1={cy(88)} y2={cy(88)} stroke={MINT} strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
    <circle cx={cx(CANDLES.length - 1)} cy={cy(88)} r="3" fill={MINT} />

    {/* legend */}
    <g fontFamily="JetBrains Mono, monospace" fontSize="10">
      <line x1={X0} x2={X0 + 16} y1="190" y2="190" stroke={AMBER} strokeWidth="1.6" strokeDasharray="5 4" />
      <text x={X0 + 22} y="193" fill="#9AA3B2">
        VWAP
      </text>
      <rect x={X0 + 96} y="186" width="8" height="8" rx="1.5" fill={MINT} opacity="0.75" />
      <text x={X0 + 110} y="193" fill="#9AA3B2">
        1 min bars
      </text>
    </g>
  </svg>
);

/* -------------------------------------------------------------- marks ---- */

const Frame = ({ children, label }) => (
  <svg viewBox="0 0 48 48" className="h-11 w-11" role="img" aria-label={label}>
    {children}
  </svg>
);

export const PatternMark = () => (
  <Frame label="Three candlesticks">
    <line x1="12" x2="12" y1="16" y2="34" stroke={MINT} strokeWidth="1.4" opacity="0.8" />
    <rect x="8.5" y="20" width="7" height="10" rx="1.5" fill={MINT} opacity="0.7" />
    <line x1="24" x2="24" y1="12" y2="32" stroke={MINT} strokeWidth="1.4" opacity="0.8" />
    <rect x="20.5" y="15" width="7" height="12" rx="1.5" fill={MINT} opacity="0.7" />
    <line x1="36" x2="36" y1="10" y2="30" stroke={BEAR} strokeWidth="1.4" opacity="0.85" />
    <rect x="32.5" y="13" width="7" height="9" rx="1.5" fill={BEAR} opacity="0.75" />
    <path d="M29 36h14" stroke="#EDEFF3" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="3 3" />
  </Frame>
);

export const ScoreMark = () => (
  <Frame label="A gauge reading above the halfway point">
    <path d="M8 36a16 16 0 0 1 32 0" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="3" strokeLinecap="round" />
    <path d="M8 36a16 16 0 0 1 10-14.9" fill="none" stroke={MINT} strokeWidth="3" strokeLinecap="round" />
    <path d="M24 36l9-10" stroke="#EDEFF3" strokeWidth="2" strokeLinecap="round" />
    <circle cx="24" cy="36" r="2.6" fill="#EDEFF3" />
  </Frame>
);

export const VolMark = () => (
  <Frame label="A volatility estimate with an uncertainty band">
    <path d="M6 30l9-11 8 7 7-13 6 9 6-4" fill="none" stroke={MINT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 22l9-11 8 7 7-13 6 9 6-4" fill="none" stroke={AMBER} strokeWidth="1.3" strokeDasharray="4 3" />
    <path d="M6 38l9-11 8 7 7-13 6 9 6-4" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.3" />
  </Frame>
);

export const NewsMark = () => (
  <Frame label="A headline with its source summary">
    <rect x="8" y="11" width="32" height="26" rx="4" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
    <rect x="13" y="17" width="14" height="2.6" rx="1.3" fill="#EDEFF3" />
    <rect x="13" y="23" width="22" height="2.2" rx="1.1" fill="rgba(255,255,255,0.4)" />
    <rect x="13" y="28.5" width="17" height="2.2" rx="1.1" fill="rgba(255,255,255,0.4)" />
    <circle cx="34.5" cy="17" r="2.6" fill={MINT} />
  </Frame>
);

export const CalendarMark = () => (
  <Frame label="A calendar with one release marked">
    <rect x="8" y="10" width="32" height="28" rx="4" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
    <line x1="8" x2="40" y1="18" y2="18" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />
    <line x1="16" x2="16" y1="6" y2="13" stroke="#EDEFF3" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="32" x2="32" y1="6" y2="13" stroke="#EDEFF3" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="12" y="21" width="6" height="6" rx="1.5" fill="rgba(255,255,255,0.18)" />
    <rect x="21" y="21" width="6" height="6" rx="1.5" fill={AMBER} opacity="0.85" />
    <rect x="30" y="21" width="6" height="6" rx="1.5" fill="rgba(255,255,255,0.18)" />
    <rect x="12" y="30" width="6" height="4" rx="1.5" fill="rgba(255,255,255,0.12)" />
    <rect x="21" y="30" width="6" height="4" rx="1.5" fill="rgba(255,255,255,0.12)" />
  </Frame>
);
