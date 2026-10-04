import { useState } from "react";

export const Num = ({ value, className = "", testId }) => (
  <span data-testid={testId} className={`num inline-block overflow-hidden align-bottom ${className}`}>
    <span key={value} className="num-in">{value}</span>
  </span>
);

export const Spark = ({ points, color = "#FFB347", className = "h-10 w-full" }) => {
  if (!points?.length) return <svg className={className} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1 || 1)) * 200).toFixed(1)} ${(36 - ((p - min) / (max - min || 1)) * 32).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 200 40" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const scoreTone = (s) => (s >= 60 ? "bull" : s <= 40 ? "bear" : "warn");
export const TONE = {
  bull: { text: "text-mint", bg: "bg-mint/10", border: "border-mint/30", hex: "#00E5A0", label: "Bullish" },
  bear: { text: "text-bear", bg: "bg-bear/10", border: "border-bear/30", hex: "#FF4D6A", label: "Bearish" },
  warn: { text: "text-amber", bg: "bg-amber/10", border: "border-amber/30", hex: "#FFB347", label: "Neutral" },
};

/** Small "?" button with a tooltip explaining a metric in plain English. */
export const Info = ({ id, text, align = "right" }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="tip" data-open={open}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="grid h-6 w-6 place-items-center rounded-full border border-white/15 text-steel transition-colors hover:border-mint/60 hover:text-mint"
        aria-label="What does this mean"
        data-testid={`demo-tooltip-${id}`}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true"><path d="M6 5.2v3.6M6 3.2v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <span className={`tip-body ${align === "left" ? "tip-left" : ""}`} role="tooltip" data-testid={`demo-tooltip-body-${id}`}>{text}</span>
    </span>
  );
};
