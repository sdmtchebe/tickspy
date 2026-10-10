export const Logo = ({ className = "", testId = "brand-logo", alt = "TickSPY" }) => (
  <span
    data-testid={testId}
    className={`inline-flex items-center ${className}`}
  >
    <img
      src={`${process.env.PUBLIC_URL || "."}/tickspy-wordmark.png`}
      alt={alt}
      className="block h-9 w-[130px] object-contain sm:h-10 sm:w-[145px]"
    />
  </span>
);
