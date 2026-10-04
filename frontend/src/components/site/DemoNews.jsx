import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TONE } from "@/components/site/bits";

const POOL = [
  { t: "NVDA", src: "Market wire", h: "Data center revenue guidance raised for next quarter", ai: "Bigger chip orders ahead. Bullish for NVDA and suppliers.", tone: "bull" },
  { t: "SPY", src: "Rates desk", h: "10 year Treasury yield falls to 3.9% after soft auction", ai: "Cheaper borrowing tends to lift the whole market.", tone: "bull" },
  { t: "TSLA", src: "Autos", h: "Quarterly deliveries come in 6% under estimates", ai: "Fewer cars sold than expected. Watch for a gap down.", tone: "bear" },
  { t: "AAPL", src: "Tech", h: "Services revenue hits a record, hardware flat", ai: "Steady quarter. No big surprise either way.", tone: "warn" },
  { t: "QQQ", src: "Macro", h: "Core inflation cools for a third straight month", ai: "Supports rate cuts. Growth stocks usually like this.", tone: "bull" },
  { t: "AMZN", src: "Retail", h: "Cloud unit margins slip on heavy AI spending", ai: "Spending more to grow. Short term pressure on profit.", tone: "bear" },
];

const stamp = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export const DemoNews = ({ active }) => {
  const idx = useRef(3);
  const [items, setItems] = useState(() => POOL.slice(0, 3).map((p, i) => ({ ...p, key: i, time: stamp() })));
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      const p = POOL[idx.current % POOL.length];
      idx.current += 1;
      setItems((list) => [{ ...p, key: idx.current, time: stamp() }, ...list].slice(0, 4));
    }, 3200);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <h3 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">Read the morning in one pass.</h3>
        <p className="mt-4 text-[15px] leading-relaxed text-steel">Every headline gets a one line summary and a lean: good, bad or neutral for the stock. New stories slide in as they break.</p>
        <div className="mt-6 flex gap-4 text-[12px]">
          {["bull", "warn", "bear"].map((k) => (
            <span key={k} className={`flex items-center gap-2 ${TONE[k].text}`}><span className="h-2 w-2 rounded-full" style={{ background: TONE[k].hex }} />{TONE[k].label}</span>
          ))}
        </div>
      </div>
      <div className="flex min-h-[460px] min-w-0 flex-col gap-3 lg:col-span-8" data-testid="demo-news-feed">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((n) => (
            <motion.article
              key={n.key}
              layout
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border hairline bg-white/[0.025] p-5"
              data-testid="demo-news-item"
            >
              <div className="flex items-center gap-3 text-[12px] text-steel">
                <span className="num font-semibold text-ink">{n.t}</span>
                <span>{n.src}</span>
                <span className="num ml-auto">{n.time}</span>
              </div>
              <p className="mt-2 text-[15px] font-medium text-ink">{n.h}</p>
              <div className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${TONE[n.tone].border} ${TONE[n.tone].bg} ${TONE[n.tone].text}`}>
                <span className="font-semibold">AI</span>
                <span className="text-ink/90">{n.ai}</span>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
