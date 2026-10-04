import { useEffect } from "react";
import { Toaster } from "sonner";
import "@/App.css";
import "lenis/dist/lenis.css";
import { startLenis } from "@/lib/site";
import { Sky } from "@/components/site/Sky";
import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Marquee } from "@/components/site/Marquee";
import { Features } from "@/components/site/Features";
import { Demo } from "@/components/site/Demo";
import { HowItWorks } from "@/components/site/HowItWorks";
import { SetupGuide } from "@/components/site/SetupGuide";
import { Why } from "@/components/site/Why";
import { Contact } from "@/components/site/Contact";
import { Footer } from "@/components/site/Footer";

function App() {
  useEffect(() => {
    const stop = startLenis();
    return () => stop();
  }, []);

  return (
    <div className="relative min-h-screen bg-void text-ink">
      <Sky />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Marquee />
        <Features />
        <Demo />
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
          style: { background: "#0E1324", border: "1px solid rgba(255,255,255,0.12)", color: "#E8ECF4", fontFamily: "DM Sans, sans-serif" },
        }}
      />
    </div>
  );
}

export default App;
