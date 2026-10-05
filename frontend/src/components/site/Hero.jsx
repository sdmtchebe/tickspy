import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { HeroCard } from "@/components/site/HeroCard";
import { scrollToId, openApp } from "@/lib/site";

const LINES = [
  [{ t: "Zero dollars.", mint: true }],
  [{ t: "Every setup." }],
];

const STATS = [["$0", "per month"], ["14", "live indicators"], ["Backtested", "volatility model"], ["Any", "US ticker"]];

export const Hero = () => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const cardScale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section ref={ref} id="home" className="relative flex min-h-[100svh] items-center pb-24 pt-32 lg:pt-28" data-testid="hero-section">
      <div className="mx-auto grid w-full max-w-desk grid-cols-1 items-center gap-16 px-6 lg:grid-cols-12 lg:gap-12">
        <motion.div className="lg:col-span-6" style={{ y: copyY, opacity: fade }}>
          <p className="rise mb-8 flex items-center gap-3 text-[13px] font-medium text-steel" style={{ animationDelay: "120ms" }}>
            <span className="h-px w-8 bg-mint" />
            Free day trading desk
          </p>
          <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[76px]" data-testid="hero-headline">
            {LINES.map((parts, i) => (
              <span key={i} className="line-mask">
                <span className="line-inner" style={{ animationDelay: `${200 + i * 140}ms` }}>
                  {parts.map((p) => (p.mint ? <span key={p.t} className="text-mint text-glow">{p.t}</span> : <span key={p.t}>{p.t}</span>))}
                </span>
              </span>
            ))}
          </h1>
          <p className="rise mt-8 max-w-[520px] text-[17px] leading-relaxed text-steel sm:text-lg" style={{ animationDelay: "560ms" }} data-testid="hero-subheadline">
            TickSPY reads live charts, a backtested volatility model and news for any US ticker, then tells you what it means in <span className="text-ink">plain English</span>. Free, with no account wall.
          </p>
          <div className="rise mt-10 flex flex-wrap items-center gap-4" style={{ animationDelay: "680ms" }}>
            <button className="btn btn-solid" onClick={openApp} data-testid="hero-cta-open-app">
              Open App
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M4 12L12 4M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            </button>
            <button className="btn btn-ghost" onClick={() => scrollToId("how-it-works")} data-testid="hero-cta-how-it-works">See How It Works</button>
          </div>
          <dl className="rise mt-14 grid max-w-[560px] grid-cols-2 gap-6 border-t hairline pt-6 sm:grid-cols-4" style={{ animationDelay: "800ms" }} data-testid="hero-stats">
            {STATS.map(([k, v]) => (
              <div key={v}>
                <dt className="num text-[22px] font-medium text-ink">{k}</dt>
                <dd className="mt-1 text-[13px] text-steel">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
        <motion.div className="lg:col-span-6" style={{ y: cardY, scale: cardScale }}>
          <div className="rise" style={{ animationDelay: "420ms" }}>
            <HeroCard />
          </div>
        </motion.div>
      </div>
      <motion.div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-steel md:flex" style={{ opacity: fade }} aria-hidden="true">
        Scroll
        <span className="scroll-cue h-8 w-px bg-gradient-to-b from-mint to-transparent" />
      </motion.div>
    </section>
  );
};
