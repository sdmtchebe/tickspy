import { motion } from "framer-motion";
import { Reveal, group, groupItem } from "@/components/site/motion";

/*
 * The honesty section.
 *
 * This is the one place on the page where the copy is allowed to be long,
 * because it is the only claim a competitor cannot copy: the measured record,
 * with its caveats attached. It deliberately has no card and no ornament — a
 * frosted panel with a rotating reticle behind four identical numbered rows
 * said "template" no matter what the words were.
 *
 * Every figure below was taken from the model's own reported results over five
 * years of 5-minute SPY bars. Nothing here is rounded up, and the things that
 * were never measured are listed as gaps rather than left out.
 */

const TICKERS = ["SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "COIN"];

const EVIDENCE = [
  {
    head: "Volatility model",
    line: (
      <>
        Over five years of 5-minute SPY bars, the walk-forward HAR(1,5,22) estimate with a GARCH(1,1) cross-check cut RMSE by{" "}
        <span className="num text-mint">10–16%</span> against a naive baseline, in every fold we tested.
      </>
    ),
    note: "Only one ticker and one timeframe were tested. The LSTM correction stage is wired up but carries no weight in the shipped build, so in practice this is HAR-only. Where it does badly is written down inside the desk.",
  },
  {
    head: "Indicator score",
    line: (
      <>
        The same five years, split by reading: bullish and bearish scores were followed by{" "}
        <span className="num text-ink">much the same returns</span>.
      </>
    ),
    note: "That is why the score is described as what trend, momentum and volume are doing right now. It is not a forecast, and the page never presents it as one.",
  },
  {
    head: "Left unmeasured",
    line: <>The news lean and the pattern labels carry no accuracy claim anywhere on this site.</>,
    note: "Neither was ever scored against outcomes, so neither gets a number. We would rather leave a figure out than print one we cannot reproduce.",
  },
];

export const Why = () => (
  <section className="section-pad relative z-10" data-testid="why-section">
    <div className="shell">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <p className="t-label">The measured record</p>
          <h2 className="t-title mt-5 text-ink">The parts we would rather not print are on this page too.</h2>
          <p className="t-lead mt-5 max-w-[420px]">
            A trading tool that only describes its good days is not giving you analysis, it is giving you a pitch. So here is the
            whole picture, including the results that argue against us.
          </p>
        </div>

        <motion.ul
          variants={group(0.08)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          className="lg:col-span-7"
        >
          {/* 1. A statement. Nothing else is needed. */}
          <motion.li variants={groupItem} className="rule pt-7" data-testid="why-point-1">
            <h3 className="t-subtitle text-ink">It costs nothing, and there is no second tier to upgrade to.</h3>
            <p className="t-body mt-3 max-w-[620px]">
              No paywall, no trial that quietly expires, no “pro” panel kept dark until you pay. Every tool the desk has, everyone
              gets, on the same day it is built.
            </p>
          </motion.li>

          {/* 2. A worked example, so the claim is demonstrable rather than asserted. */}
          <motion.li variants={groupItem} className="rule mt-9 pt-7" data-testid="why-point-2">
            <h3 className="t-subtitle text-ink">Every number arrives with the sentence that explains it.</h3>
            <p className="t-body mt-3 max-w-[620px]">
              If a label needs looking up, we wrote it badly. This is the level of detail behind each reading:
            </p>
            <dl className="well mt-5 grid gap-5 px-5 py-4 sm:grid-cols-2">
              <div>
                <dt className="num text-[12.5px] text-ink">ATR 14</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-steel">
                  How far this stock typically travels in a single bar, averaged over the last fourteen.
                </dd>
              </div>
              <div>
                <dt className="num text-[12.5px] text-ink">Bollinger %B</dt>
                <dd className="mt-1 text-[13.5px] leading-relaxed text-steel">
                  Where price sits inside its normal range: 0 at the lower band, 1 at the upper.
                </dd>
              </div>
            </dl>
          </motion.li>

          {/* 3. A list, because the claim itself is a list. */}
          <motion.li variants={groupItem} className="rule mt-9 pt-7" data-testid="why-point-3">
            <h3 className="t-subtitle text-ink">Any US ticker, not only the ten names everyone already watches.</h3>
            <p className="t-body mt-3 max-w-[620px]">The same panels run on whatever you type into the search box.</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {TICKERS.map((t) => (
                <li key={t} className="chip num">
                  {t}
                </li>
              ))}
              <li className="chip">and the rest</li>
            </ul>
          </motion.li>

          {/* 4. Pointing at the record below rather than repeating it. */}
          <motion.li variants={groupItem} className="rule mt-9 pt-7" data-testid="why-point-4">
            <h3 className="t-subtitle text-ink">The results that go against us are printed beside the ones that do not.</h3>
            <p className="t-body mt-3 max-w-[620px]">
              A model described only on its good days is marketing. The measured record sits directly underneath, caveats and all.
            </p>
          </motion.li>
        </motion.ul>
      </div>

      <div className="mt-16 border-t border-line pt-10">
        <h3 className="text-[15px] font-medium text-ink">What was actually measured</h3>
        <div className="mt-7 grid gap-9 md:grid-cols-3 md:gap-10">
          {EVIDENCE.map((e, i) => (
            <Reveal key={e.head} delay={i * 0.06}>
              <p className="num text-[12.5px] text-steel">{e.head}</p>
              <p className="mt-3 text-[14px] leading-relaxed text-ink">{e.line}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-faint">{e.note}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  </section>
);
