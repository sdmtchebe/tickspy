import { motion } from "framer-motion";
import { ArrowRight, BellRing, Check, ShieldCheck, Timer, Volume2 } from "lucide-react";
import { Reveal, group, groupItem } from "@/components/site/motion";
import { DESK_PATH } from "@/lib/site";

/*
 * Desktop alerts.
 *
 * The desk's alerts always ran on the page's own clock, but they only ever
 * wrote a toast in the corner — invisible to anyone who had switched away.
 * This section describes what the desk does now: every alert leaves three ways
 * (system notification, sound, badge), each with its own switch, and all of it
 * stays in the visitor's browser.
 *
 * The card on the right is a drawing of a notification, not a screenshot: it
 * uses a round number and says "example", because a plausible-looking price for
 * SPY would be a fabricated market figure wearing a product badge.
 */

const DESK_ALERTS = `${DESK_PATH}#alert`;

const STEPS = [
  {
    n: "01",
    title: "Add a rule in the desk",
    body: "Price above or below a level, above or below VWAP, or any pattern that appears — plus economic releases, warned a chosen number of minutes before they land and again on release.",
  },
  {
    n: "02",
    title: "Press Allow notifications",
    body: "The browser asks, not us: the permission belongs to your system and can be withdrawn there at any time. Deny it and nothing breaks — the sound and the badge keep working on their own.",
  },
  {
    n: "03",
    title: "Set how it behaves",
    body: "Four tones, a volume slider, the badge on or off, and quiet hours for the night. Play a test alert to hear it before you rely on it. Every setting is stored in this browser under one key.",
  },
];

const FACTS = [
  {
    icon: BellRing,
    head: "Three ways out, each a switch",
    text: "A system notification your desktop shows even behind other windows, a tone you chose at a volume you set, and a red count on the Alerts tab. Use one, two or all three.",
  },
  {
    icon: ShieldCheck,
    head: "No account, no server, nothing sent",
    text: "The permission, the tone and the badge live in your browser. No email, no phone number, no sign-up — and no server is ever told that an alert fired.",
  },
  {
    icon: Timer,
    head: "Honest about the limits",
    text: "Alerts fire while the desk is open, including with the tab in the background, and they stop with the tab. Quiet hours hold the sound and the notification while the badge keeps counting.",
  },
];

/* A notification as a diagram: what the desk puts on your desktop. */
const NotificationMock = () => (
  <div className="panel p-4 sm:p-5" data-testid="desktop-alert-mock">
    <div className="flex items-center gap-3 border-b border-line pb-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
        <BellRing className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-ink">TickSPY</p>
        <p className="text-[11.5px] text-faint">desktop alert · example</p>
      </div>
      <span className="num ml-auto shrink-0 text-[11px] text-faint">now</span>
    </div>

    <div className="mt-3.5 space-y-2.5">
      <div className="rounded-[12px] border border-line bg-surface2 px-3.5 py-2.5">
        <p className="text-[12.5px] font-medium leading-snug text-ink">SPY is above 500.00</p>
        <p className="mt-1 text-[12px] leading-snug text-steel">Now 501.25 — price alert from TickSPY.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300">
          2
          <span className="font-normal text-rose-200/80">on the Alerts tab</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-well px-2 py-1 text-[11px] text-steel">
          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> Chime · 60%
        </span>
      </div>
    </div>

    <p className="mt-3.5 border-t border-line pt-3 text-[12px] leading-snug text-faint">
      An alert reports that a condition was observed. No direction, no target, no advice — and never a trade.
    </p>
  </div>
);

export const DesktopAlerts = () => (
  <section id="desktop-alerts" className="section-pad relative z-10" data-testid="desktop-alerts-section">
    <div className="shell">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-12">
        <div className="lg:col-span-7">
          <Reveal>
            <p className="t-label">Alerts that find you</p>
            <h2 className="t-title mt-4 text-ink">
              A badge, a sound, a notification — <span className="acc">each one a switch</span>.
            </h2>
          </Reveal>
        </div>
        <div className="lg:col-span-5">
          <Reveal delay={0.08}>
            <p className="t-body">
              Price levels, VWAP distances, patterns and the releases that move the market arrive three ways at once: a
              system notification, a tone you choose at a volume you set, and a red count on the Alerts tab. No account
              and no server — the permission and every setting stay in your browser.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="mt-14 grid gap-8 lg:grid-cols-12 lg:items-start lg:gap-12">
        <motion.ol
          variants={group(0.07)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="lg:col-span-7"
        >
          {STEPS.map((s, i) => (
            <motion.li key={s.n} variants={groupItem} className={i === 0 ? "pb-8" : "rule py-8"}>
              <div className="grid gap-4 sm:grid-cols-[54px_1fr] sm:gap-6">
                <span className="num text-[13px] leading-6 text-mint">{s.n}</span>
                <div className="min-w-0">
                  <h3 className="t-subtitle text-ink">{s.title}</h3>
                  <p className="t-body mt-2 max-w-[68ch]">{s.body}</p>
                </div>
              </div>
            </motion.li>
          ))}

          <motion.li variants={groupItem} className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <a className="btn btn-solid" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer" data-testid="desktop-alerts-open-desk">
                Open the Alerts tab
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-steel">
                <Check className="h-3.5 w-3.5 text-mint" aria-hidden="true" />
                Free · nothing to sign up for
              </span>
            </div>
            <p className="t-body mt-3 max-w-[68ch] text-[13px]">
              The browser will ask once for permission to show notifications, and you can withdraw it whenever you like
              in your browser's site settings. The desk never asks for an email, a phone number or a name.
            </p>
          </motion.li>
        </motion.ol>

        <Reveal delay={0.1} className="lg:col-span-5">
          <NotificationMock />
        </Reveal>
      </div>

      <motion.ul
        variants={group(0.06)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.15 }}
        className="mt-14 grid gap-6 md:grid-cols-3"
      >
        {FACTS.map(({ icon: Icon, head, text }) => (
          <motion.li key={head} variants={groupItem} className="panel p-5">
            <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-line bg-well text-mint">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-[16px] font-medium tracking-[-0.01em] text-ink">{head}</h3>
            <p className="t-body mt-2 text-[13px]">{text}</p>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  </section>
);
