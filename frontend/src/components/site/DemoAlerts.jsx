import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TONE } from "@/components/site/bits";
import { IndicatorBoard } from "@/components/site/IndicatorBoard";
import { PRICE_ALERT_TICKERS } from "@/lib/indicators";
import { TICKERS } from "@/lib/market";

// An alert tells you a condition just became true. It does not tell you what
// happens next, so the bodies below describe the condition and stop there.
const POOL = [
  { tone: "bull", t: "SPY", kind: "Price", title: "Crossed above 548.10", body: "The level you set was crossed. This is a notification, not a suggestion." },
  { tone: "bull", t: "NVDA", kind: "Trend", title: "EMA 9 crossed above EMA 21", body: "The two averages swapped order on this bar." },
  { tone: "warn", t: "CPI", kind: "Calendar", title: "Inflation report in 15 minutes", body: "Scheduled release, high impact. When it lands is not something the desk can time." },
  { tone: "bear", t: "TSLA", kind: "RSI", title: "RSI 14 crossed above 70", body: "The reading moved above 70. It says where price sits in its recent range, nothing more." },
  { tone: "warn", t: "QQQ", kind: "Squeeze", title: "Keltner squeeze firing", body: "Bollinger bands have moved outside the Keltner channel." },
  { tone: "bear", t: "AAPL", kind: "MACD", title: "MACD histogram turned negative", body: "The histogram crossed below zero." },
  { tone: "bull", t: "SPY", kind: "Volume", title: "Relative volume 1.8x", body: "Volume is running at about 1.8 times its usual level for this hour." },
  { tone: "warn", t: "NVDA", kind: "ADX", title: "ADX dropped below 20", body: "ADX 14 is under 20, which measures how strongly a trend has been trending." },
  { tone: "bear", t: "QQQ", kind: "Price", title: "Fell below 474.00", body: "The level you set was crossed to the downside." },
  { tone: "bull", t: "AAPL", kind: "Stoch", title: "Stochastic crossed up from 18", body: "The oscillator moved up out of its lower band." },
];

const Mark = ({ tone }) => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] shrink-0" aria-hidden="true" style={{ color: TONE[tone].hex }}>
    <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {tone === "bull" && <path d="M6 12l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    {tone === "bear" && <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    {tone === "warn" && <path d="M10 6v5M10 14v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
  </svg>
);

const stamp = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const PriceAlertForm = ({ onArm }) => {
  const [t, setT] = useState("SPY");
  const [dir, setDir] = useState("above");
  const [price, setPrice] = useState(TICKERS.SPY.base.toFixed(2));
  const pick = (sym) => { setT(sym); setPrice(TICKERS[sym].base.toFixed(2)); };
  const submit = (e) => {
    e.preventDefault();
    const p = parseFloat(price);
    if (!Number.isFinite(p)) return;
    onArm({ t, dir, price: p });
  };
  return (
    <form onSubmit={submit} className="well p-4" data-testid="price-alert-form">
      <div className="mb-3 text-[12.5px] text-steel">Set a price alert</div>
      <div className="flex flex-wrap gap-1.5">
        {PRICE_ALERT_TICKERS.map((s) => (
          <button type="button" key={s} onClick={() => pick(s)} data-testid={`price-alert-ticker-${s.toLowerCase()}`}
            className={`num rounded-lg border px-3 py-1 text-[12px] transition-colors duration-150 ${t === s ? "border-mint/50 bg-mint/10 text-mint" : "border-line text-steel hover:border-white/20 hover:text-ink"}`}>{s}</button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
        <div className="flex rounded-lg border border-line p-0.5">
          {["above", "below"].map((d) => (
            <button type="button" key={d} onClick={() => setDir(d)} data-testid={`price-alert-dir-${d}`}
              className={`rounded-[6px] px-3 text-[12px] capitalize transition-colors duration-150 ${dir === d ? (d === "above" ? "bg-mint/15 text-mint" : "bg-bear/15 text-bear") : "text-steel"}`}>{d}</button>
          ))}
        </div>
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="field num !py-2 !text-[14px]" aria-label="Alert price" data-testid="price-alert-price-input" />
      </div>
      <button type="submit" className="btn btn-ghost btn-sm mt-3 w-full" data-testid="price-alert-submit">Arm alert</button>
    </form>
  );
};

export const DemoAlerts = ({ active }) => {
  const idx = useRef(2);
  const [items, setItems] = useState(() => POOL.slice(0, 2).map((p, i) => ({ ...p, key: i, time: stamp() })));
  const [armed, setArmed] = useState([]);

  const push = (p) => { idx.current += 1; setItems((list) => [{ ...p, key: idx.current, time: stamp() }, ...list].slice(0, 5)); };

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => { push(POOL[idx.current % POOL.length]); }, 3200);
    return () => clearInterval(id);
  }, [active]);

  const arm = (a) => {
    const key = Date.now();
    setArmed((l) => [...l, { ...a, key }]);
    setTimeout(() => {
      setArmed((l) => l.filter((x) => x.key !== key));
      push({ tone: a.dir === "above" ? "bull" : "bear", t: a.t, kind: "Price", title: `${a.dir === "above" ? "Crossed above" : "Fell below"} ${a.price.toFixed(2)}`, body: "Your price alert fired. Demo feed, so it fires fast." });
    }, 4200);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-4">
        <div>
          <h3 className="t-subtitle text-ink">Alerts that say what happened.</h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-steel">
            Price levels, any of the 14 indicators, pattern hits and calendar events. Each alert states the condition that fired,
            and stops there — the desk never tells you what to do about it.
          </p>
        </div>
        <PriceAlertForm onArm={arm} />
        <AnimatePresence>
          {armed.map((a) => (
            <motion.div key={a.key} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex items-center gap-3 rounded-lg border border-line px-4 py-2.5 text-[13px]" data-testid="armed-alert">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
              <span className="num text-ink">{a.t}</span>
              <span className="text-steel">{a.dir} {a.price.toFixed(2)}</span>
              <span className="ml-auto text-[12px] text-amber">armed</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
        <div className="flex min-h-[300px] flex-col gap-2" data-testid="demo-alerts-list">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((a) => (
              <motion.div
                key={a.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className={`well flex items-start gap-4 p-4 ${TONE[a.tone].border}`}
                data-testid="demo-alert-item"
              >
                <Mark tone={a.tone} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num text-[12px] font-medium text-ink">{a.t}</span>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[11px] ${TONE[a.tone].border} ${TONE[a.tone].text}`}>{a.kind}</span>
                    <span className="text-[14px] font-medium text-ink">{a.title}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-steel">{a.body}</p>
                  <span className="num mt-2 block text-[12px] text-steel sm:hidden">{a.time}</span>
                </div>
                <span className="num hidden text-[12px] text-steel sm:block">{a.time}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <IndicatorBoard active={active} />
      </div>
    </div>
  );
};
