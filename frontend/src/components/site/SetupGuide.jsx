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
import { Reveal, group, groupItem } from "@/components/site/motion";
import { openApp } from "@/lib/site";

/* --------------------------------------------------------------- links ---- */

const ALPACA = "https://alpaca.markets";
const ALPACA_SIGNUP = "https://app.alpaca.markets/signup";
const ALPACA_DASH = "https://app.alpaca.markets";

/* Paints the exact words a beginner has to look for, in the site's green. */
const Hi = ({ children }) => (
  <span className="rounded-[6px] bg-mint/15 px-1.5 py-px font-medium text-mint">{children}</span>
);

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
  <motion.div variants={groupItem} className="panel panel-hover h-full p-6">
    <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-line bg-well text-mint">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
    <h3 className="mt-5 text-[19px] font-medium tracking-[-0.02em] text-ink">{head}</h3>
    <p className="t-body mt-2">{text}</p>
  </motion.div>
);

/* ----------------------------------------------------------------- mocks ---- */

/*
 * A picture of the screen the step is talking about. This used to draw a fake
 * browser to make that clear, which is both a cliché and a lie about what the
 * page is showing: it is a diagram, so it is drawn as one — a recessed well
 * with a mono caption.
 */
const Mock = ({ title, children }) => (
  <div className="well p-3.5">
    <div className="mb-3 border-b border-line pb-2.5">
      <span className="num text-[11px] text-faint">{title}</span>
    </div>
    {children}
  </div>
);

/* A static mint outline around the control the step tells you to press. No
   pulsing: the ring is there to point, and a blinking page is not a helpful
   page. */
const Target = ({ children, label }) => (
  <div className="relative">
    <span className="pointer-events-none absolute -inset-1.5 rounded-[12px] border border-mint/50" aria-hidden="true" />
    {children}
    <span
      className="pointer-events-none absolute -right-1.5 -top-3 flex items-center gap-1 rounded-md border border-mint/40 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-mint"
      aria-hidden="true"
    >
      <MousePointerClick className="h-3 w-3" />
      {label}
    </span>
  </div>
);

const Row = ({ k, v }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface2 px-3 py-2">
    <span className="text-[13px] text-steel">{k}</span>
    <span className="num text-[13px] text-ink">{v}</span>
  </div>
);

const SignupMock = () => (
  <Mock title="alpaca.markets">
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-medium text-ink">Alpaca</span>
        <Target label="click here">
          <span className="rounded-lg bg-mint px-3 py-1 text-[12px] font-semibold text-[#04130D]">Sign up</span>
        </Target>
      </div>
      <div className="h-8 rounded-lg border border-line bg-surface2" />
      <div className="h-8 rounded-lg border border-line bg-surface2" />
      <div className="h-8 rounded-lg border border-line bg-surface2" />
      <p className="text-[12.5px] text-steel">Free account · no card needed</p>
    </div>
  </Mock>
);

const PaperMock = () => (
  <Mock title="app.alpaca.markets">
    <div className="space-y-3">
      <Target label="leave this on Paper">
        <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 p-1 text-[12px]">
          <span className="rounded-md bg-mint px-3 py-1 font-semibold text-[#04130D]">Paper</span>
          <span className="px-3 py-1 text-steel">Live</span>
        </div>
      </Target>
      <div className="grid grid-cols-3 gap-2">
        {["Equity $100,000", "Buying power $400,000", "Positions 0"].map((s) => (
          <span key={s} className="num rounded-lg border border-line bg-surface2 px-2 py-2 text-center text-[11px] text-steel">
            {s}
          </span>
        ))}
      </div>
      <p className="text-[12.5px] text-steel">Pretend money. Real market data.</p>
    </div>
  </Mock>
);

const ApiKeysMock = () => (
  <Mock title="app.alpaca.markets — dashboard">
    <div className="grid grid-cols-[1fr_132px] gap-3">
      {/* The dashboard itself: Home, with the account switcher top-left. */}
      <div className="space-y-2 rounded-[10px] border border-line bg-surface2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md bg-mint/10 px-2 py-0.5 text-[11px] font-semibold text-mint">Paper</span>
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-well px-2 py-0.5 text-[10px] text-faint">
            <Search className="h-3 w-3" />
            Search
          </div>
        </div>
        <p className="text-[13px] font-medium text-ink">Home</p>
        <div className="grid grid-cols-3 gap-2">
          {["Equity", "Buying power", "Positions"].map((s) => (
            <span key={s} className="num rounded-md border border-line bg-well px-2 py-2 text-center text-[11px] text-faint">
              {s}
            </span>
          ))}
        </div>
        <div className="h-6 rounded-md bg-well" />
        <div className="h-6 rounded-md bg-well" />
      </div>
      {/* The API Keys panel sits on the right-hand side of the dashboard. */}
      <div className="space-y-2.5 rounded-[10px] border border-mint/25 bg-mint/[0.06] p-2.5">
        <p className="rounded-md bg-mint/10 px-2 py-1.5 text-[12px] font-semibold text-mint">API Keys</p>
        <p className="text-[11px] leading-snug text-steel">Your keys live here.</p>
        <Target label="click here">
          <span className="inline-block rounded-lg bg-mint px-2.5 py-1.5 text-[11px] font-semibold text-[#04130D]">Generate New Key</span>
        </Target>
      </div>
    </div>
  </Mock>
);

const CopyField = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-faint">{label}</p>
        <p className="num truncate text-[13px] text-ink">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => setCopied(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-steel transition-colors duration-150 hover:border-mint/50 hover:text-mint"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
};

const KeysMock = () => (
  <Mock title="app.alpaca.markets — API Keys">
    <div className="space-y-2.5">
      <Target label="copy both">
        <div className="space-y-2">
          <CopyField label="Key ID" value="PKXXXXXXXXXXXXXXXXXX" />
          <CopyField label="Secret Key" value="••••••••••••••••••••••••••" />
        </div>
      </Target>
      <p className="rounded-lg border border-amber/25 bg-amber/[0.08] px-3 py-2 text-[12.5px] text-amber">
        The Secret Key is shown once. Copy it now.
      </p>
    </div>
  </Mock>
);

const PasteMock = () => (
  <Mock title="TickSPY — Settings">
    <div className="space-y-2.5">
      <Row k="Alpaca key ID" v="PKXXXXXXXXXXXXXXXXXX" />
      <Target label="press Save">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-mint/25 bg-mint/[0.06] px-3 py-2">
          <span className="text-[13px] text-steel">Alpaca secret</span>
          <span className="num text-[13px] text-ink">••••••••••</span>
        </div>
      </Target>
      <span className="inline-block rounded-lg bg-mint px-3 py-1.5 text-[12px] font-semibold text-[#04130D]">Save</span>
      <p className="text-[12.5px] text-steel">Stored in this browser. Never sent to us.</p>
    </div>
  </Mock>
);

/* ---------------------------------------------------------------- steps ---- */

const STEPS = [
  {
    n: "01",
    title: "Make a free Alpaca account",
    short: "Go to alpaca.markets",
    text: (
      <>
        Open{" "}
        <a href={ALPACA_SIGNUP} target="_blank" rel="noopener noreferrer" className="link">
          alpaca.markets
        </a>{" "}
        in a new tab and press <Hi>Sign up</Hi> in the top-right corner. Enter your email and a password, then open the message Alpaca emails you and click <Hi>Confirm Email</Hi>.
      </>
    ),
    look: "Sign up",
    why: "This account is what lets Alpaca issue you a personal key. Confirming your email is what unlocks the dashboard — until you click it, Alpaca will not let you generate keys at all.",
    Mock: SignupMock,
  },
  {
    n: "02",
    title: "Stay on the Paper account",
    short: "Paper, not Live",
    text: (
      <>
        Alpaca has two modes: <Hi>Paper</Hi>, which uses pretend money, and <Hi>Live</Hi>, which uses real money. Once you are signed in, the account switcher sits in the <Hi>top-left corner</Hi> of the dashboard — make sure <Hi>Paper</Hi> is the one selected. If a page ever asks for your ID card or bank details, you have slipped into Live; switch back to Paper.
      </>
    ),
    look: "Paper (top-left)",
    why: "Paper gives you everything TickSPY needs — exactly the same live market data — with none of the risk. It is the safest place to start, and you can switch later whenever you want.",
    Mock: PaperMock,
  },
  {
    n: "03",
    title: "Open the API Keys panel",
    short: "On the dashboard",
    text: (
      <>
        On your{" "}
        <a href={ALPACA_DASH} target="_blank" rel="noopener noreferrer" className="link">
          Alpaca dashboard
        </a>
        , the <Hi>API Keys</Hi> panel sits on the <Hi>right-hand side</Hi> of the Home page. If you cannot spot it straight away, use the search box at the top and type <Hi>API</Hi>. That panel is where Alpaca hands out your keys.
      </>
    ),
    look: "API Keys",
    why: "Alpaca deliberately keeps keys together in one panel, so they are easy to find and just as easy to switch off again if one ever gets loose.",
    Mock: ApiKeysMock,
  },
  {
    n: "04",
    title: "Generate a key and copy both parts",
    short: "Copy both",
    text: (
      <>
        Press <Hi>Generate New Key</Hi> — on some layouts the button reads "Generate New Keys". Alpaca then shows two values: an <Hi>API Key ID</Hi> (it starts with the letters <Hi>PK</Hi>) and a <Hi>Secret Key</Hi>. Copy each one, or press the copy button beside it, and keep this tab open for a moment.
      </>
    ),
    look: "Generate New Key",
    why: "The Key ID is like a username and the Secret Key is like a password. The Secret Key is shown only once, so copy it now — otherwise you will have to delete the pair and make a fresh one.",
    Mock: KeysMock,
  },
  {
    n: "05",
    title: "Paste them into TickSPY",
    short: "Then press Save",
    text: (
      <>
        Open the TickSPY desk below and go to the <Hi>Settings</Hi> tab. Paste the Key ID into the first box and the Secret Key into the second, then press <Hi>Save</Hi>. The desk starts loading live prices straight away.
      </>
    ),
    look: "Settings, then Save",
    why: "Your keys are saved inside your own browser only — never on a server of ours. They are sent to Alpaca and to nobody else, and you can remove them at any time by clearing the boxes.",
    Mock: PasteMock,
  },
];

const FAQ = [
  ["Is it safe to paste my keys?", "Yes, as long as it is your own browser. The keys live in your browser's local storage on this device. They are sent only to Alpaca, never to us or anyone else. Treat them like a password and do not share them or paste them on a public computer."],
  ["What if I lose the Secret Key?", "Nothing breaks. Go back to the API Keys page, delete the old key, and generate a new one. Then paste the new Key ID and Secret into TickSPY again."],
  ["Do I have to pay anything?", "No. TickSPY is free and the Alpaca market data it uses is included with a free account. You never enter a card and you never fund the account."],
  ["Do I also need a Gemini key?", "No, and there is nowhere to enter one. TickSPY needs an Alpaca key to show prices, and that is the only key the desk asks for. The one piece of machine-written text here is a single shared market overview, written on our own server from the public headlines and the scheduled events and shown to every visitor from the same copy. Your browser never talks to an AI provider."],
  ["It says the prices are not loading. What now?", "Check that you copied each value completely, with no extra spaces at the start or end, and that you used the Key ID, not the Secret, in the first box. Then press Save again."],
];

const Step = ({ n, title, short, text, look, why, Mock: MockView }, i) => (
  <motion.li
    variants={groupItem}
    className={`relative grid gap-6 pl-14 md:grid-cols-2 md:gap-10 md:pl-16 ${i < STEPS.length - 1 ? "pb-14" : ""}`}
    data-testid={`setup-step-${i + 1}`}
  >
    <span className="num absolute left-0 top-0 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-[13px] text-ink">
      {n}
    </span>
    <div>
      <span className="chip">{short}</span>
      <h3 className="t-subtitle mt-3 text-ink">{title}</h3>
      <p className="t-body mt-2.5">{text}</p>
      {look ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-steel">
          <Search className="h-3.5 w-3.5 text-mint" aria-hidden="true" />
          Look for
          <span className="rounded-md border border-mint/40 bg-mint/10 px-2 py-0.5 font-medium text-mint">{look}</span>
        </p>
      ) : null}
      <p className="mt-3 border-l-2 border-line pl-3 text-[14px] leading-relaxed text-steel">
        <span className="font-medium text-ink">Why: </span>
        {why}
      </p>
    </div>
    <div>
      <MockView />
    </div>
  </motion.li>
);

const Faq = ({ q, a }) => (
  <details className="group rounded-[10px] border border-line bg-surface2 px-5 py-4" data-testid="setup-faq">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
      {q}
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line text-steel transition-transform duration-200 group-open:rotate-45"
        aria-hidden="true"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    </summary>
    <p className="t-body mt-3">{a}</p>
  </details>
);

export const SetupGuide = () => (
  <section id="setup" className="section-pad relative z-10" data-testid="setup-section">
    <div className="shell">
      <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="t-label">Setup</p>
          <h2 className="t-title mt-4 text-ink">How to create and paste your free Alpaca keys</h2>
        </div>
        <Reveal delay={0.12} className="lg:col-span-5">
          <div className="max-w-[460px] lg:ml-auto">
            <p className="t-body">
              You do not need any of this to look around. With no keys at all, the desk still opens with the last completed
              session's prices, the news, the calendar and a shared market overview. Free keys from{" "}
              <a href={ALPACA} target="_blank" rel="noopener noreferrer" className="link">
                Alpaca
              </a>{" "}
              are what make it live.
            </p>
            <p className="t-body mt-3">
              You make them yourself in about two minutes. Below is every click, one at a time, with the button to press
              highlighted in <span className="font-medium text-mint">green</span>.
            </p>
          </div>
        </Reveal>
      </div>

      <motion.div
        variants={group(0.07)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.15 }}
        className="mt-14 grid gap-5 md:grid-cols-3"
      >
        {WHY.map((w) => (
          <WhyCard key={w.head} {...w} />
        ))}
      </motion.div>

      <motion.ol
        variants={group(0.06)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.05 }}
        className="relative mt-16"
      >
        <span className="absolute bottom-8 left-[17px] top-3 w-px bg-line" aria-hidden="true" />
        {STEPS.map((s, i) => (
          <Step key={s.n} {...s} i={i} />
        ))}
      </motion.ol>

      <Reveal className="mt-16">
        <div className="panel p-6 sm:p-9">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[10px] border border-line bg-well text-mint">
              <LifeBuoy className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="text-[21px] font-medium tracking-[-0.02em] text-ink">Common questions</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {FAQ.map(([q, a]) => (
              <Faq key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal className="mt-6">
        <div className="panel px-6 py-10 text-center sm:px-10">
          <h3 className="text-[24px] tracking-[-0.025em] text-ink">Ready when you are</h3>
          <p className="t-body mx-auto mt-3 max-w-[520px]">
            Have your two keys copied? Open the desk, paste them into Settings, and you are done. Your keys stay in your browser,
            and you can remove them whenever you like.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button className="btn btn-solid" onClick={openApp} data-testid="setup-open-app">
              Open the desk
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <a className="btn btn-ghost" href={ALPACA} target="_blank" rel="noopener noreferrer" data-testid="setup-alpaca-link">
              Open Alpaca
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);
