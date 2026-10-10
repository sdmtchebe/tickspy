import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import "lenis/dist/lenis.css";
import { startLenis, scrollToId } from "@/lib/site";
import { resetAdsConsent } from "@/lib/privacy";
import { Sky } from "@/components/site/Sky";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { SpecStrip } from "@/components/site/SpecStrip";
import { Demo } from "@/components/site/Demo";
import { AdSlot } from "@/components/site/AdSlot";
import { Features } from "@/components/site/Features";
import { HowItWorks } from "@/components/site/HowItWorks";
import { SetupGuide } from "@/components/site/SetupGuide";
import { Why } from "@/components/site/Why";
import { Contact } from "@/components/site/Contact";
import { CookieConsent } from "@/components/site/CookieConsent";
import { Footer } from "@/components/site/Footer";
import { AD_SLOTS } from "@/lib/ads";
import { LocaleProvider } from "@/lib/i18n";

/*
 * Page order is the argument the page makes: show the desk, then explain what
 * is in it, then how to get it running. The tour sits above the feature list
 * on purpose — the product is the pitch, and a grid of cards claiming things
 * is worth less than one panel the visitor can click through first.
 *
 * Ad units sit between sections rather than inside them, and never beside a
 * CTA, a form or the demo tabs: an ad next to a button invites accidental
 * clicks, which is both bad UX and against AdSense policy. Each one renders
 * only when its slot ID is configured, so the layout is unchanged otherwise.
 */
function App() {
  useEffect(() => {
    const stop = startLenis();
    if (new URLSearchParams(window.location.search).has("cookie-settings")) {
      resetAdsConsent();
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
    const frame = requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      if (id) scrollToId(id);
    });
    return () => { cancelAnimationFrame(frame); stop(); };
  }, []);

  // No opaque background on this wrapper either: painting bg-void here hid the
  // body's scrolling gradient, so the whole page sat on one flat colour.
  return (
    <LocaleProvider><MotionConfig reducedMotion="user"><div className="app-shell relative text-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-surface focus:p-3">Skip to content</a>
      <Sky />
      <Nav />
      <main id="main-content" tabIndex={-1} className="relative z-10">
        <Hero />
        <SpecStrip />
        <Demo />
        <AdSlot slot={AD_SLOTS.afterDemo} className="pb-2" />
        <Features />
        <HowItWorks />
        <AdSlot slot={AD_SLOTS.afterHow} className="pb-2" />
        <SetupGuide />
        <Why />
        <Contact />
      </main>
      <Footer />
      <CookieConsent />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: { background: "#141924", border: "1px solid rgba(255,255,255,0.14)", color: "#EDEFF3", fontFamily: "DM Sans, sans-serif" },
        }}
      />
    </div></MotionConfig></LocaleProvider>
  );
}

export default App;
