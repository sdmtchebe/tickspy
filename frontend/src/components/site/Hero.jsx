import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { HeroCard } from "@/components/site/HeroCard";
import { scrollToId, DESK_PATH } from "@/lib/site";

/* Four facts, all of them checkable in the desk. */
const STATS = [
  ["$0", "no card, no account"],
  ["9", "desk sections"],
  ["14", "indicators scored"],
  ["1m – 1d", "timeframes"],
];

export const Hero = () => {
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 70]);
  const fade = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  return (
    <section ref={ref} id="home" className="relative pb-24 pt-32 sm:pt-36" data-testid="hero-section">
      <div className="shell grid grid-cols-1 items-center gap-14 lg:grid-cols-12 lg:gap-10">
        <motion.div className="lg:col-span-6" style={{ opacity: reduceMotion ? 1 : fade }}>
          <p className="t-label rise flex items-center gap-3 text-cobalt" style={{ animationDelay: "60ms" }}>
            <span className="h-px w-6 bg-cobalt" aria-hidden="true" />
            Free market analysis desk
          </p>

          {/* Two short lines, each one unbroken at every width from 320px up.
              A single long line wrapped to three ragged rows at desktop, which
              is the giveaway that a headline was written before it was set. */}
          <h1 className="t-display mt-6 text-ink" data-testid="hero-headline">
            <span className="line-mask">
              <span className="line-inner" style={{ animationDelay: "120ms" }}>
                Every number,
              </span>
            </span>
            <span className="line-mask">
              <span className="line-inner" style={{ animationDelay: "220ms" }}>
                <span className="border-b-[3px] border-mint pb-[0.05em] text-mint">explained</span>.
              </span>
            </span>
          </h1>

          <p className="t-lead rise mt-7 max-w-[560px]" style={{ animationDelay: "380ms" }} data-testid="hero-subheadline">
            TickSPY draws the candles, runs 14 indicators, a volatility model, the news and the calendar for any US ticker, then says
            what each reading means in one plain sentence. <strong className="text-cobalt">No account required</strong>, and nothing held back behind a
            paywall.
          </p>

          <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "460ms" }}>
            <a className="btn btn-solid" href={DESK_PATH} target="_blank" rel="noopener noreferrer" data-testid="hero-cta-open-app">
              Open the desk
            </a>
            <button className="btn btn-ghost" onClick={() => scrollToId("demo")} data-testid="hero-cta-how-it-works">
              See it in action
            </button>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-steel">Free mode replays a completed session. Current prices and 1-minute bars require your own Alpaca keys.</p>

          <dl className="rise mt-12 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-line pt-7 sm:grid-cols-4" style={{ animationDelay: "540ms" }} data-testid="hero-stats">
            {STATS.map(([k, v]) => (
              <div key={v}>
                <dt className="num text-[21px] leading-none text-mint">{k}</dt>
                <dd className="mt-2 text-[13px] leading-snug text-steel">{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div className="lg:col-span-6" style={{ y: reduceMotion ? 0 : cardY }}>
          <div className="rise" style={{ animationDelay: "300ms" }}>
            <HeroCard />
          </div>
        </motion.div>
      </div>
    </section>
  );
};
