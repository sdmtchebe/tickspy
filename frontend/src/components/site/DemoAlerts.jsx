import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TONE } from "@/components/site/bits";
import { IndicatorBoard } from "@/components/site/IndicatorBoard";
import { PRICE_ALERT_TICKERS } from "@/lib/indicators";
import { TICKERS } from "@/lib/market";

const POOL = [
  { tone: "bull", t: "SPY", kind: "Price", title: "Crossed above 548.10", body: "Your price alert fired. Buyers took control of the session average." },
  { tone: "bull", t: "NVDA", kind: "Trend", title: "EMA 9 crossed above EMA 21", body: "Short-term trend flipped up. Momentum usually follows within a few bars." },
  { tone: "warn", t: "CPI", kind: "Calendar", title: "Inflation report in 15 minutes", body: "Big releases can move every ticker. Tighten stops or wait." },
  { tone: "bear", t: "TSLA", kind: "RSI", title: "RSI 14 crossed above 70", body: "Overbought. Pullbacks are common from here, not guaranteed." },
  { tone: "warn", t: "QQQ", kind: "Squeeze", title: "Keltner squeeze firing", body: "Bollinger bands pushed outside the Keltner channel. Expect a bigger move." },
  { tone: "bear", t: "AAPL", kind: "MACD", title: "MACD histogram turned negative", body: "Momentum rolled over below zero." },
  { tone: "bull", t: "SPY", kind: "Volume", title: "Relative volume 1.8x", body: "Almost double the usual tape for this hour. Moves carry more weight." },
  { tone: "warn", t: "NVDA", kind: "ADX", title: "ADX dropped below 20", body: "Trend strength faded. Range tactics work better than breakouts." },
  { tone: "bear", t: "QQQ", kind: "Price", title: "Fell below 474.00", body: "Your price alert fired. Prior support did not hold." },
  { tone: "bull", t: "AAPL", kind: "Stoch", title: "Stochastic crossed up from 18", body: "Oversold cross. Early bounce signal." },
];

const Mark = ({ tone }) => (
  <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden="true" style={{ color: TONE[tone].hex }}>
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
    <form onSubmit={submit} className="glass-inner rounded-2xl p-4" data-testid="price-alert-form">
      <div className="mb-3 text-[12px] text-steel">Set a price alert</div>
      <div className="flex flex-wrap gap-1.5">
        {PRICE_ALERT_TICKERS.map((s) => (
          <button type="button" key={s} onClick={() => pick(s)} data-testid={`price-alert-ticker-${s.toLowerCase()}`}
            className={`num rounded-full border px-3 py-1 text-[12px] transition-colors ${t === s ? "border-mint/50 bg-mint/10 text-mint" : "border-white/10 text-steel hover:text-ink"}`}>{s}</button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
        <div className="flex rounded-xl border border-white/10 p-0.5">
          {["above", "below"].map((d) => (
            <button type="button" key={d} onClick={() => setDir(d)} data-testid={`price-alert-dir-${d}`}
              className={`rounded-[10px] px-3 text-[12px] capitalize transition-colors ${dir === d ? (d === "above" ? "bg-mint/15 text-mint" : "bg-bear/15 text-bear") : "text-steel"}`}>{d}</button>
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
          <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">Alerts that say why.</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-steel">Price levels, any of the 14 indicators, pattern hits and calendar events. Each alert says what happened and what it usually means.</p>
        </div>
        <PriceAlertForm onArm={arm} />
        <AnimatePresence>
          {armed.map((a) => (
            <motion.div key={a.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="flex items-center gap-3 rounded-xl border border-white/10 px-4 py-2.5 text-[13px]" data-testid="armed-alert">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-amber text-amber" />
              <span className="num text-ink">{a.t}</span>
              <span className="text-steel">{a.dir} {a.price.toFixed(2)}</span>
              <span className="ml-auto text-[11px] uppercase tracking-wider text-amber">armed</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
        <div className="flex min-h-[300px] flex-col gap-3" data-testid="demo-alerts-list">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((a) => (
              <motion.div
                key={a.key}
                layout
                initial={{ opacity: 0, scale: 0.94, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className={`glass-inner flex items-start gap-4 rounded-2xl p-4 ${TONE[a.tone].border}`}
                data-testid="demo-alert-item"
              >
                <Mark tone={a.tone} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="num text-[12px] font-semibold text-ink">{a.t}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${TONE[a.tone].border} ${TONE[a.tone].text}`}>{a.kind}</span>
                    <span className="text-[14px] font-medium text-ink">{a.title}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-steel">{a.body}</p>
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
