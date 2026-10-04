export const YGlyph = () => (
  <svg viewBox="0 0 62 72" className="inline-block h-[0.72em] w-[0.6em] align-baseline" aria-hidden="true">
    <path d="M-2 -14 L31 38 L64 -14" fill="none" stroke="currentColor" strokeWidth="13.5" strokeLinejoin="miter" />
    <path d="M31 36 V45 M31 54 V72" fill="none" stroke="currentColor" strokeWidth="13.5" />
    <path d="M17 49.5 H24 M38 49.5 H45" stroke="#00E5A0" strokeWidth="3" />
  </svg>
);

const IGlyph = () => (
  <svg viewBox="0 0 26 72" className="inline-block h-[0.72em] w-[0.26em] align-baseline mx-[0.02em]" aria-hidden="true">
    <path d="M13 1 L22 12 H4 Z" fill="#E8ECF4" />
    <rect x="7" y="20" width="12" height="52" fill="currentColor" />
  </svg>
);

export const Logo = ({ className = "", testId = "brand-logo" }) => (
  <span data-testid={testId} className={`inline-flex items-baseline font-display font-semibold tracking-[-0.03em] leading-none ${className}`} aria-label="TickSPY">
    <span className="text-mint drop-shadow-[0_0_14px_rgba(0,229,160,0.45)]" aria-hidden="true">
      T<IGlyph />ck
    </span>
    <span className="ml-[0.06em] text-ink" aria-hidden="true">SP</span>
    <span className="text-ink" aria-hidden="true"><YGlyph /></span>
  </span>
);

export const ReticleMark = ({ className = "h-5 w-5", accent = "#00E5A0" }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M32 6v9M32 49v9M6 32h9M49 32h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M22 38l7-7 5 4 9-11M37 23h7v7" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
