import { motion } from "framer-motion";
import { ArrowRight, BellRing, Check, MessageCircle, ShieldCheck, Timer } from "lucide-react";
import { Reveal, group, groupItem } from "@/components/site/motion";
import { DESK_PATH } from "@/lib/site";
import { TelegramConnect } from "@/components/site/TelegramConnect";

/*
 * Alerts on Telegram.
 *
 * The desk's own alerts only run while its tab is open, which is the one thing
 * people discover too late. This section is the answer to that, and it is
 * written as a tutorial rather than as a feature card, because the feature is
 * only worth anything if the visitor finishes the four clicks that turn it on.
 *
 * The chat on the right is a drawing of what arrives, not a screenshot: it uses
 * round numbers and is labelled "example", because a plausible-looking price for
 * SPY would be a fabricated market figure wearing a demo badge.
 */

const BOT = "@tickspy_alerts_bot";
const DESK_ALERTS = `${DESK_PATH}#alert`;

const STEPS = [
  {
    n: "01",
    title: "Choose a rule below",
    body: "Set a price, or ask for headlines and calendar releases. Press Connect Telegram and this page makes a one-time code that expires in fifteen minutes. The full rule editor stays in the desk for quiet hours, big moves and keywords.",
  },
  {
    n: "02",
    title: "Press START in the chat it opens",
    body: `The button opens ${BOT} in whichever Telegram you already use — phone, desktop or web. The code travels inside the link, so the only thing to press is the START button Telegram puts at the bottom of a new chat.`,
  },
  {
    n: "03",
    title: "Come back, and send yourself a test",
    body: "The panel below notices by itself, usually within three seconds, and switches on. Press Send a test message to see one arrive. Change the full rule set in the desk whenever you like; it applies to the chat immediately.",
  },
];

const MESSAGES = [
  {
    key: "price",
    title: "SPY is above 500.00",
    body: "Now 501.25 — price alert from TickSPY.",
    time: "09:41",
  },
  {
    key: "calendar",
    title: "CPI — HIGH IMPACT in 15 min",
    body: "Scheduled release · forecast 3.1%.",
    time: "08:15",
  },
  {
    key: "news",
    title: "2 new headlines",
    body: "• Chip demand lifts the index\n• Fed official signals patience",
    time: "07:52",
  },
];

const FACTS = [
  {
    icon: Timer,
    head: "Checked every five minutes",
    text: "The server re-reads your rules on a five-minute schedule, so an alert is “within about five minutes”, not instant. A rule speaks once when it becomes true, then stays quiet for half an hour instead of repeating.",
  },
  {
    icon: ShieldCheck,
    head: "No account, no phone number",
    text: "What the server keeps is the chat it may message, your rules, and when each rule last fired. No email, no name, no IP. Disconnect and delete removes the record, and /stop in the chat does the same thing.",
  },
  {
    icon: BellRing,
    head: "It reaches you with the desk closed",
    text: "This is the difference from the alerts inside the desk: those stop when the tab closes. These arrive as ordinary Telegram messages, so they also show up on a lock screen, a watch and a second device.",
  },
];

/* A chat as a diagram: a bot that only ever states what happened. */
const ChatMock = () => (
  <div className="panel p-4 sm:p-5" data-testid="telegram-chat-mock">
    <div className="flex items-center gap-3 border-b border-line pb-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
        <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-ink">{BOT}</p>
        <p className="text-[11.5px] text-faint">bot · example messages</p>
      </div>
      <span className="num ml-auto shrink-0 text-[11px] text-faint">Telegram</span>
    </div>

    <div className="mt-3.5 space-y-2.5">
      {/* Incoming on the left, the person's own command on the right, the way
          Telegram draws a chat. */}
      {MESSAGES.map((m) => (
        <div key={m.key} className="max-w-[92%] rounded-[12px] rounded-bl-[4px] border border-line bg-surface2 px-3.5 py-2.5">
          <p className="text-[12.5px] font-medium leading-snug text-ink">{m.title}</p>
          <p className="mt-1 whitespace-pre-line text-[12px] leading-snug text-steel">{m.body}</p>
          <p className="num mt-1.5 text-right text-[10.5px] text-faint">{m.time}</p>
        </div>
      ))}
      <div className="ml-auto max-w-[70%] rounded-[12px] rounded-br-[4px] border border-line bg-well px-3.5 py-2">
        <p className="num text-[12px] text-ink">/rules</p>
      </div>
    </div>

    <p className="mt-3.5 border-t border-line pt-3 text-[12px] leading-snug text-faint">
      An alert reports that a condition was observed. No direction, no target, no advice — and never a trade.
    </p>
  </div>
);

export const TelegramAlerts = () => (
  <section id="telegram-alerts" className="section-pad relative z-10" data-testid="telegram-section">
    <div className="shell">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-12">
        <div className="lg:col-span-7">
          <Reveal>
            <p className="t-label">Alerts that find you</p>
            <h2 className="t-title mt-4 text-ink">
              Close the desk. The <span className="acc">alerts keep arriving</span>.
            </h2>
          </Reveal>
        </div>
        <div className="lg:col-span-5">
          <Reveal delay={0.08}>
            <p className="t-body">
              Price levels, headlines about the tickers you follow, and the economic releases that move the market — sent to
              Telegram by our server, on its own schedule, whether or not the desk is open.
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
              <a className="btn btn-solid" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer" data-testid="telegram-open-desk">
                Open the full rule editor
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-steel">
                <Check className="h-3.5 w-3.5 text-mint" aria-hidden="true" />
                Free · needs a Telegram account and nothing else
              </span>
            </div>
            <p className="t-body mt-3 max-w-[68ch] text-[13px]">
              You will need the free Telegram app or{" "}
              <a href="https://web.telegram.org" target="_blank" rel="noopener noreferrer" className="link">
                Telegram Web
              </a>{" "}
              to press START once. Telegram carries the messages, so they are private to your chat but are not end-to-end
              encrypted against Telegram itself.
            </p>
          </motion.li>
        </motion.ol>

        <Reveal delay={0.1} className="lg:col-span-5">
          <ChatMock />
        </Reveal>
      </div>

      <Reveal delay={0.08} className="mt-12">
        <TelegramConnect />
      </Reveal>

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
