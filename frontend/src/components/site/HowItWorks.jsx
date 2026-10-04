import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Reveal, SplitWords, stagger, item } from "@/components/site/motion";

const WORD = "AAPL";

const SearchMock = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v + 1) % 14), 280);
    return () => clearInterval(id);
  }, []);
  const typed = WORD.slice(0, Math.min(n, WORD.length));
  return (
    <div className="rounded-2xl border hairline bg-[#070A14]/70 p-4">
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-steel" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <span className="num text-[15px] text-ink">{typed}<span className="caret" /></span>
      </div>
      <div className={`mt-2 flex items-center justify-between rounded-xl px-4 py-2.5 transition-opacity duration-300 ${n >= WORD.length ? "bg-mint/[0.07] opacity-100" : "opacity-0"}`}>
        <span className="text-[13px] text-ink"><span className="num font-semibold">AAPL</span> <span className="text-steel">Apple Inc.</span></span>
        <span className="num text-[13px] text-mint">226.14</span>
      </div>
    </div>
  );
};

const BARS = [["Trend", 0.78, "#00E5A0"], ["Momentum", 0.62, "#00E5A0"], ["Volatility", 0.44, "#FFB347"], ["News lean", 0.7, "#00E5A0"]];

const AnalysisMock = () => (
  <div className="space-y-3 rounded-2xl border hairline bg-[#070A14]/70 p-4">
    {BARS.map(([k, v, c], i) => (
      <div key={k} className="grid grid-cols-[96px_1fr] items-center gap-4">
        <span className="text-[13px] text-steel">{k}</span>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="fill-bar h-full rounded-full" style={{ width: `${v * 100}%`, background: c, animationDelay: `${i * 0.18}s` }} />
        </div>
      </div>
    ))}
  </div>
);

const DecisionMock = () => (
  <div className="rounded-2xl border hairline bg-[#070A14]/70 p-4">
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-steel">AAPL score</span>
      <span className="badge-pulse rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-[12px] font-semibold text-mint">Bullish 72</span>
    </div>
    <p className="mt-3 text-[14px] leading-relaxed text-ink">Price is above VWAP and the trend is up. Volatility is normal, so a typical day moves about $2.10. Nothing big on the calendar until 2pm.</p>
  </div>
);

const STEPS = [
  { n: "01", title: "Pick any stock", text: "Type a ticker. Large caps, small caps and ETFs all work, not just the ones everyone talks about.", Mock: SearchMock },
  { n: "02", title: "Get instant analysis", text: "Trend, momentum, volatility and news get checked in seconds. Each number comes with a short note on what it means.", Mock: AnalysisMock },
  { n: "03", title: "Make informed decisions", text: "You get one score and a short summary. TickSPY does not tell you to buy or sell. It shows you what is happening so you can decide.", Mock: DecisionMock },
];

export const HowItWorks = () => (
  <section id="how-it-works" className="section-pad relative z-10" data-testid="how-it-works-section">
    <div className="mx-auto grid max-w-desk gap-16 px-6 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-32">
          <SplitWords text={["Three steps.", "About ten seconds."]} accent={["ten", "seconds"]} className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl" />
          <Reveal delay={0.3}><p className="mt-6 max-w-[360px] text-base text-steel md:text-lg">No setup, no indicators to configure, no manual to read first.</p></Reveal>
        </div>
      </div>
      <ol className="relative lg:col-span-8">
        <motion.span
          className="absolute bottom-6 left-[19px] top-6 w-px origin-top bg-gradient-to-b from-mint/70 via-mint/20 to-transparent"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        />
        {STEPS.map(({ n, title, text, Mock }, i) => (
          <motion.li
            key={n}
            variants={stagger(0.12)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className={`relative grid gap-6 pl-16 ${i < STEPS.length - 1 ? "pb-16" : ""} md:grid-cols-2 md:gap-10`}
            data-testid={`how-step-${i + 1}`}
          >
            <motion.span variants={item} className="num absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full border border-mint/40 bg-void text-[13px] text-mint shadow-[0_0_24px_-6px_rgba(0,229,160,0.6)]">{n}</motion.span>
            <motion.div variants={item}>
              <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-steel">{text}</p>
            </motion.div>
            <motion.div variants={item} className="glass rounded-2xl p-1"><Mock /></motion.div>
          </motion.li>
        ))}
      </ol>
    </div>
  </section>
);
