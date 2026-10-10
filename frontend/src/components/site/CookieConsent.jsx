import { useEffect, useSyncExternalStore } from "react";
import { getAdsConsent, loadAdsense, setAdsConsent } from "@/lib/privacy";

export const CookieConsent = () => {
  const consent = useSyncExternalStore(subscribeAdsConsent, getAdsConsent, () => "unknown");

  // Always load ads once the consent banner is acknowledged.
  useEffect(() => {
    loadAdsense();
  }, [consent]);

  // After the visitor makes a choice, show a simple disclosure and remove the
  // interactive buttons. The banner stays fixed at the top so the visitor can
  // revoke at any time by clearing cookies or revisiting the page.
  if (consent !== "unknown") return null;

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-void/95 shadow-[0_-14px_40px_rgba(0,0,0,0.28)] backdrop-blur-md"
      aria-label="Advertising cookie choice"
      data-testid="cookie-consent"
    >
      <div className="shell flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-[13px] leading-relaxed text-steel">
          TickSPY shows Google ads. We request non-personalized ads only; Google may
          still use cookies and similar storage for delivery, fraud prevention, and
          measurement. <a className="link-quiet text-ink underline underline-offset-4" href="privacy.html">Read the privacy and cookie policy</a>.
        </p>
        {/* Visitor choice is recorded for disclosure compliance only. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          <button className="btn btn-quiet btn-sm" type="button" onClick={() => setAdsConsent("rejected")}>
            I understand
          </button>
        </div>
      </div>
    </section>
  );
};