import { motion } from "framer-motion";
import { CalendarMark, NewsMark, PatternMark, PricesArt, ScoreMark, VolMark } from "@/components/site/FeatureArt";
import { Reveal, group, groupItem } from "@/components/site/motion";

/*
 * Capabilities.
 *
 * One lead feature carrying the chart, then five compact rows. The earlier
 * version was a 2x3 grid of identical cards, each with an identical art well,
 * an 01-06 badge, and the same hover lift — which is a lot of ceremony for six
 * short paragraphs, and made every feature look equally important, including
 * the ones nobody opens twice.
 */

const LEAD = {
  title: "Live prices and the chart",
  body: [
    "Type any US ticker and the desk draws the candles, with ATR 14, VWAP, Bollinger %B and a volume strip beside them. Every reading has a question mark next to it that explains, in one sentence, what the number is actually measuring.",
    "With no account at all you get a cached end-of-day session, which is enough to see the shape of the day. Add free read-only Alpaca keys that you generate yourself and the same panels switch to live intraday quotes that move as the bars arrive. The keys stay in your browser — there is no server of ours for them to be sent to.",
  ],
};

const ROWS = [
  {
    id: "patterns",
    Mark: PatternMark,
    title: "Named candle patterns, marked on the chart",
    text: "The desk scans every bar for formations it can name — hammer, engulfing, shooting star — and marks the ones it finds with a note on what that shape usually means.",
  },
  {
    id: "score",
    Mark: ScoreMark,
    title: "One reading from 0 to 100, and what it is not",
    text: "Trend, momentum and volume roll into a single number. It describes what the indicators say at that moment, and it is not a forecast. Measured across five years of 5-minute SPY bars, bullish and bearish readings were followed by much the same returns, which is exactly why the desk never presents the score as a prediction.",
  },
  {
    id: "volatility",
    Mark: VolMark,
    title: "A volatility estimate you can audit",
    text: "Garman-Klass realized volatility feeds a walk-forward HAR(1,5,22) model, with a GARCH(1,1) cross-check alongside it. A gated LSTM correction stage is wired up, but it currently earns no weight in the shipped build, so in practice this is HAR-only. Over five years of 5-minute SPY bars it beat a naive baseline by 10-16% RMSE in every fold tested. The record also writes down where it does badly, including that only one ticker and one timeframe were ever tested.",
  },
  {
    id: "news",
    Mark: NewsMark,
    title: "Headlines with their own summary attached",
    text: "Each headline arrives with the short summary its publisher wrote and the name of the source it came from, so you can see who is talking. On top of that, one market overview is written once on our server from the public headlines and the day's scheduled events, then served to every visitor from the same cached copy. It adds no view of its own.",
  },
  {
    id: "calendar",
    Mark: CalendarMark,
    title: "An economic calendar you can be warned by",
    text: "CPI, jobs reports and Fed decisions, grouped by day and filtered to the releases with medium or high impact. Set an alert and the desk warns you before one lands, so a scheduled number does not catch you in the middle of a position.",
  },
];

const ALSO = ["Key levels", "Multi-timeframe view", "Relative strength", "Volume profile", "Price alerts"];

export const Features = () => (
  <section id="features" className="section-pad relative z-10" data-testid="features-section">
    <div className="shell">
      <div className="max-w-[680px]">
        <Reveal>
          <p className="t-label">What is in the desk</p>
          <h2 className="t-title mt-4 text-ink">
            Everything the desk can do is on the free tier, with nothing held back behind an account.
          </h2>
        </Reveal>
      </div>

      <Reveal delay={0.08} className="mt-14 grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="lg:col-span-5">
          <h3 className="t-subtitle text-ink">{LEAD.title}</h3>
          {LEAD.body.map((p) => (
            <p key={p.slice(0, 24)} className="t-body mt-4">
              {p}
            </p>
          ))}
        </div>
        <div className="lg:col-span-7">
          <div className="well p-5 sm:p-6" data-testid="feature-card-prices">
            <PricesArt />
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="num text-[12px] text-steel">SPY · simulated 1 minute series</span>
              <span className="num text-[12px] text-faint">demo data</span>
            </div>
          </div>
        </div>
      </Reveal>

      <motion.ul
        variants={group(0.05)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.1 }}
        className="mt-16"
        data-testid="feature-list"
      >
        {ROWS.map(({ id, Mark, title, text }) => (
          <motion.li variants={groupItem} key={id} className="rule py-8" data-testid={`feature-card-${id}`}>
            <div className="grid gap-5 sm:grid-cols-[64px_1fr] sm:gap-8">
              <div className="well grid h-16 w-16 place-items-center">
                <Mark />
              </div>
              <div className="min-w-0">
                <h3 className="t-subtitle text-ink">{title}</h3>
                <p className="t-body mt-2.5 max-w-[76ch]">{text}</p>
              </div>
            </div>
          </motion.li>
        ))}
      </motion.ul>

      <div className="rule pt-8">
        <p className="text-[13.5px] text-steel">Also in the desk:</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ALSO.map((t) => (
            <li key={t} className="chip">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);
