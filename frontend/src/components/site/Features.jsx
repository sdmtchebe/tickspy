import { motion } from "framer-motion";
import { PricesArt, PatternArt, ScoreArt, VolatilityArt, NewsArt, CalendarArt } from "@/components/site/FeatureArt";
import { Reveal, SplitWords } from "@/components/site/motion";

const FEATURES = [
  { id: "prices", Art: PricesArt, title: "Live prices for any stock", text: "Type a ticker and watch the price move in real time. Big names or small caps, they all work the same way." },
  { id: "patterns", Art: PatternArt, title: "Candlestick and chart pattern detection", text: "TickSPY scans every candle for setups like hammers, engulfing bars and shooting stars. When one forms, it gets marked on the chart with a note on what it usually means." },
  { id: "score", Art: ScoreArt, title: "One bullish or bearish score", text: "Trend, momentum and volume get rolled into a single number from 0 to 100. Above 60 leans bullish, below 40 leans bearish." },
  { id: "volatility", Art: VolatilityArt, title: "Two-stage volatility forecasting", text: "Garman-Klass realized vol feeds a walk-forward HAR(1,5,22) model with a GARCH(1,1) cross-check. A gated LSTM then corrects the residual and adds a bearish, neutral or bullish read, with an uncertainty band from out-of-sample error." },
  { id: "news", Art: NewsArt, title: "Live news with AI summaries", text: "Headlines for the stocks you follow, each with a one line summary of why it matters. Skim the whole morning in under a minute." },
  { id: "calendar", Art: CalendarArt, title: "Economic calendar with alerts", text: "CPI, jobs reports and Fed decisions move everything. Get a heads up before they hit so you are not caught mid trade." },
];

const track = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};

export const Features = () => (
  <section id="features" className="section-pad relative z-10" data-testid="features-section">
    <div className="mx-auto max-w-desk px-6">
      <div className="mb-16 grid gap-6 lg:grid-cols-12 lg:items-end">
        <SplitWords
          text={["Everything you need.", "Nothing you don't."]}
          accent={["need"]}
          className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl lg:col-span-7"
        />
        <Reveal delay={0.3} className="lg:col-span-5 lg:justify-self-end">
          <p className="max-w-[440px] text-base text-steel md:text-lg">
            Six tools and fourteen indicators that cover the whole trading morning, from the first headline to the last candle.
          </p>
        </Reveal>
      </div>
      <div className="grid auto-rows-fr grid-cols-1 gap-6 md:grid-cols-2">
        {FEATURES.map(({ id, Art, title, text }, i) => (
          <motion.article
            key={id}
            initial={{ opacity: 0, y: 40, rotateX: 6, filter: "blur(8px)" }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)" }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.9, delay: (i % 2) * 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1200 }}
            data-testid={`feature-card-${id}`}
          >
            <div className="glass glass-hover flex h-full flex-col p-6 sm:p-8" onMouseMove={track}>
              <div className="glass-inner h-[176px] overflow-hidden rounded-2xl p-4">
                <Art />
              </div>
              <div className="mt-8 flex items-start gap-3">
                <span className="num mt-1.5 text-[11px] text-mint">0{i + 1}</span>
                <h3 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h3>
              </div>
              <p className="mt-3 pl-7 text-[15px] leading-relaxed text-steel">{text}</p>
            </div>
          </motion.article>
        ))}
      </div>
    </div>
  </section>
);
