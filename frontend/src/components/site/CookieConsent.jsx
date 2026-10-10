import { useEffect, useSyncExternalStore } from "react";
import { getAdsConsent, loadAdsense, setAdsConsent, subscribeAdsConsent } from "@/lib/privacy";

export const CookieConsent = () => {
  const consent = useSyncExternalStore(subscribeAdsConsent, getAdsConsent, () => "unknown");

  useEffect(() => {
    if (consent === "accepted") loadAdsense();
  }, [consent]);

  if (consent !== "unknown") return null;

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-void/95 shadow-[0_-14px_40px_rgba(0,0,0,0.28)] backdrop-blur-md"
      aria-label="Advertising cookie choice"
      data-testid="cookie-consent"
    >
      <div className="shell flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-[13px] leading-relaxed text-steel">
          TickSPY shows Google ads only if you allow advertising cookies. We request non-personalized ads; Google may still use
          cookies and similar storage for delivery, fraud prevention, and measurement. <a className="link-quiet text-ink underline underline-offset-4" href="privacy.html">Read the privacy and cookie policy</a>.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className="btn btn-quiet btn-sm" type="button" onClick={() => setAdsConsent("rejected")}>
            No thanks
          </button>
          <button className="btn btn-solid btn-sm" type="button" onClick={() => setAdsConsent("accepted")}>
            Allow ads
          </button>
        </div>
      </div>
    </section>
  );
};
