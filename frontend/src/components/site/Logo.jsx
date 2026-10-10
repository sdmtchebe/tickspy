import logoImage from "@/assets/tickspy-wordmark.png";

export const Logo = ({ className = "", testId = "brand-logo", alt = "TickSPY" }) => (
  <span
    data-testid={testId}
    className={`inline-flex items-center ${className}`}
  >
    <img
      src={logoImage}
      alt={alt}
      className="block h-11 w-[158px] object-contain sm:h-12 sm:w-[174px]"
    />
  </span>
);
