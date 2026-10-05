import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// These summaries deliberately restate the source and stop there. The worker's
// system prompt forbids predicting direction or saying whether something is good
// or bad, and the demo must not advertise a judgement the product refuses to make.
const POOL = [
  { t: "NVDA", src: "Market wire", h: "Data center revenue guidance raised for next quarter", ai: "Guidance raised for next quarter. The size of the raise is not stated." },
  { t: "SPY", src: "Rates desk", h: "10 year Treasury yield falls to 3.9% after soft auction", ai: "The 10 year yield closed at 3.9% after a soft auction." },
  { t: "TSLA", src: "Autos", h: "Quarterly deliveries come in 6% under estimates", ai: "Deliveries came in 6% below estimates. No cause given." },
  { t: "AAPL", src: "Tech", h: "Services revenue hits a record, hardware flat", ai: "Services at a record, hardware flat quarter on quarter." },
  { t: "QQQ", src: "Macro", h: "Core inflation cools for a third straight month", ai: "Core inflation fell for a third month. The figure is not given." },
  { t: "AMZN", src: "Retail", h: "Cloud unit margins slip on heavy AI spending", ai: "Cloud margins fell as AI spending rose. Sizes not given." },
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
        <p className="mt-4 text-[15px] leading-relaxed text-steel">Every headline gets a short summary of what it actually reports, and the summary names its source. New stories slide in as they break.</p>
        <p className="mt-6 text-[12px] leading-relaxed text-steel">
          No bull or bear label, on purpose. The summary restates what the source says and stops there. Deciding whether a headline is good or bad is your call, not the machine&apos;s.
        </p>
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
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[12px]">
                <span className="font-semibold text-mint">AI</span>
                <span className="text-ink/90">{n.ai}</span>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
