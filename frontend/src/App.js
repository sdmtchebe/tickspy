import { useEffect } from "react";
import { Toaster } from "sonner";
import "lenis/dist/lenis.css";
import { startLenis } from "@/lib/site";
import { Sky } from "@/components/site/Sky";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { SpecStrip } from "@/components/site/SpecStrip";
import { Demo } from "@/components/site/Demo";
import { Features } from "@/components/site/Features";
import { HowItWorks } from "@/components/site/HowItWorks";
import { SetupGuide } from "@/components/site/SetupGuide";
import { Why } from "@/components/site/Why";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";

/*
 * Page order is the argument the page makes: show the desk, then explain what
 * is in it, then how to get it running. The tour sits above the feature list
 * on purpose — the product is the pitch, and a grid of cards claiming things
 * is worth less than one panel the visitor can click through first.
 */
function App() {
  useEffect(() => {
    const stop = startLenis();
    return () => stop();
  }, []);

  return (
    <div className="app-shell relative bg-void text-ink">
      <Sky />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <SpecStrip />
        <Demo />
        <Features />
        <HowItWorks />
        <SetupGuide />
        <Why />
        <Contact />
      </main>
      <Footer />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: { background: "#141924", border: "1px solid rgba(255,255,255,0.14)", color: "#EDEFF3", fontFamily: "DM Sans, sans-serif" },
        }}
      />
    </div>
  );
}

export default App;
