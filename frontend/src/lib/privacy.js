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

// AdSense is always loaded with the non-personalized ad request flag.
// Google's EU/UK policy requires a disclosure before serving any ads;
// this banner provides that disclosure and records the visitor's choice.
export const loadAdsense = () => {
  if (typeof document === "undefined" || document.querySelector("script[data-tickspy-adsense]")) return;

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
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // The current page still honours the choice if storage is unavailable.
  }
  // Always load ads (non-personalized), regardless of the choice.
  loadAdsense();
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