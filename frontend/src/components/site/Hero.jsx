import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { HeroCard } from "@/components/site/HeroCard";
import { scrollToId, DESK_PATH } from "@/lib/site";
import { useLocale } from "@/lib/i18n";

const STATS = [
  ["$0", "no card, no account"],
  ["11", "desk sections"],
  ["14", "indicators scored"],
  ["1m – 1d", "timeframes"],
];

export const Hero = () => {
  const { copy } = useLocale();
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 36]);
  const fade = useTransform(scrollYProgress, [0, 0.92], [1, 0.88]);

  return (
    <section ref={ref} id="home" className="relative overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36 lg:pt-40" data-testid="hero-section">
      <div className="shell">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-12">
          <motion.div className="relative z-10 lg:col-span-5" style={{ opacity: reduceMotion ? 1 : fade }}>
            <p className="t-label rise flex items-center gap-3" style={{ animationDelay: "60ms" }}>
              <span className="h-px w-7 bg-mint" aria-hidden="true" />
              {copy.eyebrow}
            </p>

            <h1 className="t-display mt-7 max-w-[620px] text-ink lg:text-[clamp(2.45rem,3.45vw,3.2rem)]" data-testid="hero-headline">
              <span className="line-mask">
                <span className="line-inner" style={{ animationDelay: "120ms" }}>{copy.headlineA}</span>
              </span>
              <span className="line-mask">
                <span className="line-inner" style={{ animationDelay: "220ms" }}>
                  <span className="text-mint">{copy.headlineB}</span>.
                </span>
              </span>
            </h1>

            <p className="t-lead rise mt-7 max-w-[510px]" style={{ animationDelay: "320ms" }} data-testid="hero-subheadline">
              {copy.subheadline}
            </p>

            <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "400ms" }}>
              <a className="btn btn-solid" href={DESK_PATH} target="_blank" rel="noopener noreferrer" data-testid="hero-cta-open-app">
                {copy.ctaOpen}
                <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </a>
              <button className="btn btn-ghost" onClick={() => scrollToId("demo")} data-testid="hero-cta-how-it-works">
                {copy.ctaDemo}
              </button>
            </div>
            <p className="mt-4 max-w-[460px] text-[13px] leading-relaxed text-steel">{copy.footnote}</p>
          </motion.div>

          <motion.div className="lg:col-span-7" style={{ y: reduceMotion ? 0 : cardY }}>
            <div className="rise" style={{ animationDelay: "240ms" }}>
              <HeroCard />
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-3 text-[11px] text-faint">
              <span className="num uppercase tracking-[0.12em]">A closer look at the desk</span>
              <button onClick={() => scrollToId("demo")} className="link-quiet inline-flex items-center gap-2" aria-label="Explore the interactive desk demo">
                Explore the demo
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M3 8h10m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </motion.div>
        </div>

        <dl className="rise mt-14 grid grid-cols-2 border-t border-line sm:grid-cols-4" style={{ animationDelay: "500ms" }} data-testid="hero-stats">
          {STATS.map(([k], i) => (
            <div key={k} className="border-b border-line py-5 sm:border-b-0 sm:py-6 [&:not(:nth-child(4n+1))]:sm:border-l [&:not(:nth-child(4n+1))]:sm:pl-6 [&:nth-child(2n)]:pl-4 [&:nth-child(2n+1)]:pr-4 sm:[&:nth-child(2n)]:pl-0 sm:[&:nth-child(2n+1)]:pr-0">
              <dt className="num text-[20px] leading-none text-mint">{k}</dt>
              <dd className="mt-2 text-[12px] leading-snug text-steel">{copy.stats[i]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
};
