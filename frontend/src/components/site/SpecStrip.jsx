import { Reveal } from "@/components/site/motion";

/*
 * The strip under the hero answers the question a visitor asks before anything
 * else: do I have to sign up to see anything?
 *
 * The three claims here describe what the desk actually does with no keys at
 * all — the no-account path serves cached end-of-day bars, news, the calendar
 * and one shared overview from the edge — and what adding free Alpaca keys
 * changes. Both halves were checked against the running API.
 */

const FACTS = [
  {
    k: "Opens with no account",
    v: "The desk loads a chart, the indicators, the news and the calendar the moment you open it. Nothing is gated behind a sign-up.",
  },
  {
    k: "Free keys make it live",
    v: "Add read-only Alpaca keys you generate yourself and the same panels switch to live intraday quotes and streaming candles.",
  },
  {
    k: "One overview for everyone",
    v: "The written market summary is generated once on our own server and served from one cached copy, not re-written per visitor.",
  },
];

export const SpecStrip = () => (
  <section className="relative z-10 border-y border-line bg-surface/40" data-testid="spec-strip">
    <div className="shell grid gap-8 py-10 md:grid-cols-3 md:gap-10">
      {FACTS.map((f, i) => (
        <Reveal key={f.k} delay={i * 0.06}>
          {/* These are labels inside a strip, not sections of the page, so they
              stay out of the heading outline. */}
          <p className="text-[15px] font-medium text-ink">{f.k}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-steel">{f.v}</p>
        </Reveal>
      ))}
    </div>
  </section>
);
