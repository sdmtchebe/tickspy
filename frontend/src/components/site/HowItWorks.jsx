import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Reveal, group, groupItem } from "@/components/site/motion";

/*
 * The overview of the loop. Deliberately a three-up row of columns with hairline
 * tops rather than the vertical timeline it used to share with the setup
 * walkthrough — two sections built from the same component read as one section
 * repeated, and the setup guide is the one that actually needs a numbered rail.
 *
 * The mocks stay non-numeric. Inventing a plausible price for a real symbol
 * would be a lie wearing a "demo" label, and there is nothing to gain from it:
 * what the step needs to show is which readings exist and what they mean.
 */

const WORD = "AAPL";

const SearchMock = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v + 1) % 14), 280);
    return () => clearInterval(id);
  }, []);
  const typed = WORD.slice(0, Math.min(n, WORD.length));
  const matched = n >= WORD.length;
  return (
    <div className="well p-3.5">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface2 px-3.5 py-2.5">
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-faint" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="num text-[15px] text-ink">
          {typed}
          <span className="caret" />
        </span>
      </div>
      <div
        className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 transition-opacity duration-200 ${
          matched ? "opacity-100" : "opacity-0"
        }`}
      >
        <span className="text-[13px] text-ink">
          <span className="num font-medium">AAPL</span> <span className="text-steel">Apple Inc.</span>
        </span>
        <span className="text-[11.5px] text-faint">US equity</span>
      </div>
    </div>
  );
};

const CHECKS = [
  ["Trend", "EMA 9 measured against EMA 21"],
  ["Momentum", "RSI, MACD and the stochastic"],
  ["Volatility", "ATR and the Bollinger bands"],
  ["Volume", "volume against its usual level"],
];

const ChecksMock = () => (
  <div className="well p-3.5">
    <ul className="space-y-2.5">
      {CHECKS.map(([k, v]) => (
        <li key={k} className="flex items-start gap-3">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-faint" aria-hidden="true" />
          <span className="text-[13px] leading-snug text-ink">
            {k}
            <span className="mt-0.5 block text-[12.5px] leading-snug text-steel">{v}</span>
          </span>
        </li>
      ))}
    </ul>
    <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-snug text-faint">
      Every reading arrives with one sentence saying what it measures.
    </p>
  </div>
);

const SummaryMock = () => (
  <div className="well p-3.5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] text-steel">Reading · demo data</span>
      <span className="inline-flex h-7 items-center rounded-lg border border-amber/30 bg-amber/10 px-2.5 text-[12.5px] font-medium text-amber">
        Neutral 52
      </span>
    </div>
    <p className="mt-3 text-[13px] leading-relaxed text-ink">
      Price is above VWAP, the trend is up, and volatility is normal for this time of day. Nothing high impact on the calendar
      before the afternoon.
    </p>
    <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-snug text-faint">
      The desk never says buy or sell. The reading describes what the indicators show right now.
    </p>
  </div>
);

const STEPS = [
  {
    n: "01",
    title: "Type a ticker",
    text: "Any US listed symbol works — large caps, small caps and ETFs alike. You are not limited to the handful of names everyone already watches.",
    Mock: SearchMock,
  },
  {
    n: "02",
    title: "The numbers get checked",
    text: "Trend, momentum, volatility and volume are recomputed as each bar closes, and each reading is paired with a sentence explaining what it measures.",
    Mock: ChecksMock,
  },
  {
    n: "03",
    title: "You decide",
    text: "TickSPY hands over the readings and stops there. It never tells you to buy or sell, and the volatility model estimates how large a move may be rather than which way it will go.",
    Mock: SummaryMock,
  },
];

export const HowItWorks = () => (
  <section id="how-it-works" className="section-pad relative z-10" data-testid="how-it-works-section">
    <div className="shell">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="t-label">How it works</p>
          <h2 className="t-title mt-4 text-ink">
            What happens after you <span className="acc">type a ticker</span>
          </h2>
        </div>
        <Reveal delay={0.12} className="lg:col-span-5">
          <p className="t-body max-w-[430px] lg:ml-auto">
            There is nothing to configure and no manual to read first. The whole loop is <strong>three steps long</strong> and it starts
            the moment the desk opens.
          </p>
        </Reveal>
      </div>

      <motion.ol
        variants={group(0.08)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.15 }}
        className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8"
      >
        {STEPS.map(({ n, title, text, Mock }, i) => (
          <motion.li key={n} variants={groupItem} className="border-t border-line pt-6" data-testid={`how-step-${i + 1}`}>
            <span className="step-num text-[12.5px]">{n}</span>
            <h3 className="t-subtitle mt-3 text-ink">{title}</h3>
            <p className="t-body mt-2.5">{text}</p>
            <div className="mt-5">
              <Mock />
            </div>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  </section>
);
