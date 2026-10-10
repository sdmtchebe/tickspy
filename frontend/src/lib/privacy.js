import { ADSENSE_CLIENT, ADS_ENABLED } from "@/lib/ads";

const CONSENT_KEY = "tickspy-ad-consent";
const listeners = new Set();
let sessionConsent = null;

const storedConsent = () => {
  if (sessionConsent) return sessionConsent;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "rejected" ? value : "unknown";
  } catch {
    return "unknown";
  }
};

export const getAdsConsent = () => (typeof window === "undefined" ? "unknown" : storedConsent());

export const subscribeAdsConsent = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => listeners.forEach((listener) => listener());

// Consent is checked here too, so no caller can load ads before permission.
export const loadAdsense = () => {
  if (!ADS_ENABLED || getAdsConsent() !== "accepted" || typeof document === "undefined" || document.querySelector("script[data-tickspy-adsense]")) return;

  window.adsbygoogle = window.adsbygoogle || [];
  // Serve non-personalized ads. Google may still use cookies for frequency
  // capping, fraud prevention, and measurement, but not for behavioral targeting.
  window.adsbygoogle.requestNonPersonalizedAds = 1;

  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.dataset.tickspyAdsense = "true";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  document.head.appendChild(script);
};

export const setAdsConsent = (consent) => {
  if (consent !== "accepted" && consent !== "rejected") return;
  sessionConsent = consent;
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // The current page still honours the choice if storage is unavailable.
  }
  if (consent === "accepted") loadAdsense();
  else if (document.querySelector("script[data-tickspy-adsense]")) {
    // Reload to stop the already-running third-party runtime after withdrawal.
    window.location.reload();
  }
  notify();
};

export const resetAdsConsent = () => {
  sessionConsent = null;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Ignore disabled browser storage; the banner still opens this visit.
  }
  notify();
};
