const Glyph = (props) => (
  <svg viewBox="0 0 62 72" className="inline-block h-[0.72em] w-[0.6em] align-baseline" aria-hidden="true" {...props}>
    <path d="M-2 -14 L31 38 L64 -14" fill="none" stroke="currentColor" strokeWidth="13.5" strokeLinejoin="miter" />
    <path d="M31 36 V45 M31 54 V72" fill="none" stroke="currentColor" strokeWidth="13.5" />
    <path d="M17 49.5 H24 M38 49.5 H45" stroke="#00E5A0" strokeWidth="3" />
  </svg>
);

const IGlyph = () => (
  <svg viewBox="0 0 26 72" className="mx-[0.02em] inline-block h-[0.72em] w-[0.26em] align-baseline" aria-hidden="true">
    <path d="M13 1 L22 12 H4 Z" fill="#EDEFF3" />
    <rect x="7" y="20" width="12" height="52" fill="currentColor" />
  </svg>
);

export const Logo = ({ className = "", testId = "brand-logo", alt = "TickSPY" }) => (
  <span
    data-testid={testId}
    className={`inline-flex items-baseline font-display font-medium leading-none tracking-[-0.03em] ${className}`}
  >
    <img
      src="/tickspy-logo.png"
      alt={alt}
      className="h-[0.72em] w-auto"
      style={{ display: "block" }}
    />
  </span>
);