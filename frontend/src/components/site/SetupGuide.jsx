import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Wallet,
  KeyRound,
  MousePointerClick,
  Search,
  Copy,
  Check,
  ExternalLink,
  ArrowRight,
  LifeBuoy,
} from "lucide-react";
import { Reveal, SplitWords, stagger, item } from "@/components/site/motion";
import { openApp } from "@/lib/site";

/* ------------------------------------------------------------------ why ---- */

const WHY = [
  {
    icon: Wallet,
    head: "Why Alpaca?",
    text: "TickSPY does not keep its own copy of the market. Alpaca is the free service that sends it live prices. Your key is simply how Alpaca knows it is really you asking.",
  },
  {
    icon: ShieldCheck,
    head: "Free, and read-only is enough",
    text: "A free Alpaca account includes the data TickSPY uses. You never enter a card, you never fund an account, and TickSPY never places a trade. It only reads prices.",
  },
  {
    icon: KeyRound,
    head: "Your keys stay yours",
    text: "They are saved only inside your own browser, on your own device, and sent only to Alpaca. They are never sent to us, because there is no server of ours to send them to.",
  },
];

const WhyCard = ({ icon: Icon, head, text }) => (
  <motion.div variants={item} className="glass glass-hover h-full p-6">
    <span className="grid h-11 w-11 place-items-center rounded-xl border border-mint/25 bg-mint/10 text-mint">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
    <h3 className="mt-5 font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">{head}</h3>
    <p className="mt-2 text-[15px] leading-relaxed text-steel">{text}</p>
  </motion.div>
);

/* ----------------------------------------------------------------- mocks ---- */

// A small fake browser window, so every step shows where to look.
const Window = ({ title, children }) => (
  <div className="rounded-2xl border hairline bg-[#070A14]/70 p-4">
    <div className="mb-3 flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full bg-bear/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
      <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
      <span className="ml-2 truncate text-[12px] text-steel">{title}</span>
    </div>
    {children}
  </div>
);

// Mint ring + pointer that pulses on the thing to click.
const Target = ({ children, label }) => (
  <div className="relative">
    <span className="pointer-events-none absolute -inset-1.5 rounded-xl border border-mint/60 ring-4 ring-mint/10 animate-pulse" aria-hidden="true" />
    {children}
    <span className="pointer-events-none absolute -right-2 -top-3 flex items-center gap-1 rounded-full border border-mint/40 bg-void px-2 py-0.5 text-[11px] font-medium text-mint" aria-hidden="true">
      <MousePointerClick className="h-3 w-3" />
      {label}
    </span>
  </div>
);

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
    <span className="text-[13px] text-steel">{k}</span>
    <span className="num text-[13px] text-ink">{v}</span>
  </div>
);

const SignupMock = () => (
  <Window title="alpaca.markets">
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px] font-semibold text-ink">Alpaca</span>
        <Target label="click here"><span className="rounded-full bg-mint px-3 py-1 text-[12px] font-semibold text-[#03130D]">Sign up</span></Target>
      </div>
      <div className="h-8 rounded-lg border border-white/10 bg-white/[0.03]" />
      <div className="h-8 rounded-lg border border-white/10 bg-white/[0.03]" />
      <div className="h-8 rounded-lg border border-mint/20 bg-mint/[0.06]" />
      <p className="text-[12px] text-steel">Free account · no card needed</p>
    </div>
  </Window>
);

const PaperMock = () => (
  <Window title="app.alpaca.markets">
    <div className="space-y-3">
      <Target label="leave this on Paper">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 text-[12px]">
          <span className="rounded-full bg-mint px-3 py-1 font-semibold text-[#03130D]">Paper</span>
          <span className="px-3 py-1 text-steel">Live</span>
        </div>
      </Target>
      <div className="grid grid-cols-3 gap-2">
        {["Equity $100,000", "Buying power $400,000", "Positions 0"].map((s) => (
          <span key={s} className="num rounded-lg bg-white/[0.03] px-2 py-2 text-center text-[11px] text-steel">{s}</span>
        ))}
      </div>
      <p className="text-[12px] text-steel">Pretend money. Real market data.</p>
    </div>
  </Window>
);

const ApiKeysMock = () => (
  <Window title="app.alpaca.markets — dashboard">
    <div className="grid grid-cols-[92px_1fr] gap-3">
      <div className="space-y-1.5">
        {["Home", "Accounts", "API Keys", "Orders"].map((m) => {
          const hot = m === "API Keys";
          return hot ? (
            <Target key={m} label="find this"><span className="block rounded-lg bg-mint/10 px-2.5 py-1.5 text-[12px] font-semibold text-mint">{m}</span></Target>
          ) : (
            <span key={m} className="block rounded-lg px-2.5 py-1.5 text-[12px] text-steel">{m}</span>
          );
        })}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-steel">
          <Search className="h-3 w-3" /> Search
        </div>
      </div>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[13px] font-medium text-ink">API Keys</p>
        <p className="text-[12px] text-steel">Your keys are shown below.</p>
        <Target label="click here"><span className="inline-block rounded-lg bg-mint px-3 py-1.5 text-[12px] font-semibold text-[#03130D]">Generate New Key</span></Target>
      </div>
    </div>
  </Window>
);

const CopyField = ({ label, value, delay }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-steel">{label}</p>
        <p className="num truncate text-[13px] text-ink">{value}</p>
      </div>
      <motion.button
        type="button"
        onClick={() => setCopied(true)}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay, duration: 0.3 }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-steel transition-colors hover:border-mint/50 hover:text-mint"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4" />}
      </motion.button>
    </div>
  );
};

const KeysMock = () => (
  <Window title="app.alpaca.markets — API Keys">
    <div className="space-y-2.5">
      <Target label="copy both"><div className="space-y-2"><CopyField label="Key ID" value="PKXXXXXXXXXXXXXXXXXX" delay={0.1} /><CopyField label="Secret Key" value="••••••••••••••••••••••••••" delay={0.25} /></div></Target>
      <p className="rounded-lg border border-amber/25 bg-amber/[0.08] px-3 py-2 text-[12px] text-amber">The Secret Key is shown once. Copy it now.</p>
    </div>
  </Window>
);

const PasteMock = () => (
  <Window title="TickSPY — Settings">
    <div className="space-y-2.5">
      <Row k="Alpaca key ID" v="PKXXXXXXXXXXXXXXXXXX" />
      <Target label="press Save">
        <div className="flex items-center justify-between rounded-lg border border-mint/25 bg-mint/[0.06] px-3 py-2">
          <span className="text-[13px] text-steel">Alpaca secret</span>
          <span className="num text-[13px] text-ink">••••••••••</span>
        </div>
      </Target>
      <span className="inline-block rounded-lg bg-mint px-3 py-1.5 text-[12px] font-semibold text-[#03130D]">Save</span>
      <p className="text-[12px] text-steel">Stored in this browser. Never sent to us.</p>
    </div>
  </Window>
);

/* ---------------------------------------------------------------- steps ---- */

const STEPS = [
  {
    n: "01",
    title: "Make a free Alpaca account",
    short: "Go to alpaca.markets",
    text: "Open alpaca.markets in a new tab and click Sign up in the top right corner. Type your email, choose a password, and follow the confirmation. That is the whole first step.",
    why: "This account is what lets Alpaca give you your own personal key. Without an account there is nobody to issue one to.",
    Mock: SignupMock,
  },
  {
    n: "02",
    title: "Stay on the Paper account",
    short: "Paper, not Live",
    text: "Alpaca has two modes: Paper and Live. Paper uses pretend money. Near the top of the dashboard, make sure Paper is selected. If a box ever asks for your ID or bank details, you are on the wrong one — switch back to Paper.",
    why: "Paper mode gives you everything TickSPY needs and nothing that involves real money. It is the safest place to start.",
    Mock: PaperMock,
  },
  {
    n: "03",
    title: "Open the API Keys page",
    short: "In the left menu",
    text: "In the menu on the left, click API Keys. If you cannot see it straight away, click the search box and type the word API. That page is where Alpaca hands out your keys.",
    why: "Alpaca deliberately keeps keys together on one page so they are easy to manage and easy to switch off again.",
    Mock: ApiKeysMock,
  },
  {
    n: "04",
    title: "Generate a key and copy both parts",
    short: "Copy both",
    text: "Click Generate New Key. You will be shown two things: a Key ID and a Secret Key. Copy each one, or press the copy button beside it. Keep this tab open for a moment.",
    why: "The Key ID is like a username and the Secret Key is like a password. Copy the Secret now, because Alpaca shows it only once for your safety.",
    Mock: KeysMock,
  },
  {
    n: "05",
    title: "Paste them into TickSPY",
    short: "Then press Save",
    text: "Open the TickSPY desk below and go to the Settings tab. Paste the Key ID into the first box and the Secret Key into the second, then press Save. The desk loads live prices straight away.",
    why: "Your keys are saved inside your own browser only. They are sent to Alpaca and to nobody else, and you can delete them at any time by clearing the boxes.",
    Mock: PasteMock,
  },
];

const FAQ = [
  ["Is it safe to paste my keys?", "Yes, as long as it is your own browser. The keys live in your browser's local storage on this device. They are sent only to Alpaca, never to us or anyone else. Treat them like a password and do not share them or paste them on a public computer."],
  ["What if I lose the Secret Key?", "Nothing breaks. Go back to the API Keys page, delete the old key, and generate a new one. Then paste the new Key ID and Secret into TickSPY again."],
  ["Do I have to pay anything?", "No. TickSPY is free and the Alpaca market data it uses is included with a free account. You never enter a card and you never fund the account."],
  ["Do I also need a Gemini key?", "No, that one is optional. TickSPY needs an Alpaca key to show prices. A Gemini key is only used if you want the AI to summarise news and calendar events for you."],
  ["It says the prices are not loading. What now?", "Check that you copied each value completely, with no extra spaces at the start or end, and that you used the Key ID, not the Secret, in the first box. Then press Save again."],
];

const Step = ({ n, title, short, text, why, Mock }, i) => (
  <motion.li
    variants={stagger(0.12)}
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.2 }}
    className={`relative grid gap-6 pl-16 ${i < STEPS.length - 1 ? "pb-16" : ""} md:grid-cols-2 md:gap-10`}
    data-testid={`setup-step-${i + 1}`}
  >
    <motion.span variants={item} className="num absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full border border-mint/40 bg-void text-[13px] text-mint shadow-[0_0_24px_-6px_rgba(0,229,160,0.6)]">{n}</motion.span>
    <motion.div variants={item}>
      <p className="num mb-2 text-[12px] uppercase tracking-[0.22em] text-mint">{short}</p>
      <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-steel">{text}</p>
      <p className="mt-3 border-l-2 border-mint/40 pl-3 text-[14px] leading-relaxed text-steel">
        <span className="font-medium text-ink">Why: </span>{why}
      </p>
    </motion.div>
    <motion.div variants={item} className="glass rounded-2xl p-1"><Mock /></motion.div>
  </motion.li>
);

const Faq = ({ q, a }) => (
  <details className="group glass rounded-2xl px-5 py-4" data-testid="setup-faq">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
      {q}
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 text-steel transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
        <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </span>
    </summary>
    <p className="mt-3 text-[15px] leading-relaxed text-steel">{a}</p>
  </details>
);

export const SetupGuide = () => (
  <section id="setup" className="section-pad relative z-10" data-testid="setup-section">
    <div className="mx-auto max-w-desk px-6">
      <div className="mb-14 grid gap-6 lg:grid-cols-12 lg:items-end">
        <SplitWords
          text={["Set up in two minutes.", "No card. No cost."]}
          accent={["two", "minutes."]}
          className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl lg:col-span-7"
        />
        <Reveal delay={0.3} className="lg:col-span-5 lg:justify-self-end">
          <p className="max-w-[460px] text-base text-steel md:text-lg">
            TickSPY needs free keys from <span className="text-ink">Alpaca</span> to show you real live prices. You make the keys yourself in about two minutes. Here is exactly how, one click at a time.
          </p>
        </Reveal>
      </div>

      <motion.div
        variants={stagger(0.12)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="mb-20 grid gap-6 md:grid-cols-3"
      >
        {WHY.map((w) => <WhyCard key={w.head} {...w} />)}
      </motion.div>

      <ol className="relative">
        <motion.span
          className="absolute bottom-6 left-[19px] top-6 w-px origin-top bg-gradient-to-b from-mint/70 via-mint/20 to-transparent"
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        />
        {STEPS.map((s, i) => <Step key={s.n} {...s} i={i} />)}
      </ol>

      <Reveal className="mt-20">
        <div className="glass rounded-[28px] p-6 sm:p-10">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-mint/25 bg-mint/10 text-mint"><LifeBuoy className="h-5 w-5" /></span>
            <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">Common questions</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {FAQ.map(([q, a]) => <Faq key={q} q={q} a={a} />)}
          </div>
        </div>
      </Reveal>

      <Reveal className="mt-12">
        <div className="glass relative overflow-hidden rounded-[28px] p-8 text-center sm:p-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint/50 to-transparent" aria-hidden="true" />
          <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">Ready when you are.</h3>
          <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-relaxed text-steel">
            Have your two keys copied? Open the desk, paste them into Settings, and you are done. Your keys stay in your browser, and you can remove them whenever you like.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <button className="btn btn-solid" onClick={openApp} data-testid="setup-open-app">
              Open App
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <a className="btn btn-ghost" href="https://alpaca.markets" target="_blank" rel="noopener noreferrer" data-testid="setup-alpaca-link">
              Open Alpaca
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);
