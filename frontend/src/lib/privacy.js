import { ADSENSE_CLIENT } from "@/lib/ads";

const CONSENT_KEY = "tickspy-ad-consent";
const listeners = new Set();

const storedConsent = () => {
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

export const loadAdsense = () => {
  if (typeof document === "undefined" || document.querySelector("script[data-tickspy-adsense]")) return;

  // Keep this deployment on Google's non-personalized advertising path. This is
  // set before the runtime loads and avoids treating consent as consent to
  // behavioral advertising.
  window.adsbygoogle = window.adsbygoogle || [];
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
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // The current page still honours the choice if storage is unavailable.
  }
  if (consent === "accepted") loadAdsense();
  notify();
};

export const resetAdsConsent = () => {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Ignore disabled browser storage; the banner still opens this visit.
  }
  notify();
};
