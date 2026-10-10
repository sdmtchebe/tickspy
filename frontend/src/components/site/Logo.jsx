import logoImage from "@/assets/tickspy-logo-transparent.png";

export const Logo = ({ className = "", testId = "brand-logo", alt = "TickSPY" }) => (
  <span
    data-testid={testId}
    className={`inline-flex items-center ${className}`}
  >
    <img
      src={logoImage}
      alt={alt}
      className="block h-auto w-[72px] max-w-full sm:w-[84px] lg:w-[108px]"
    />
  </span>
);
