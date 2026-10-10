import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// These items stand in for the summary line a news feed publishes itself. Each
// restates what its source reported and stops there. The desk adds no bull or
// bear label of its own, and the demo must not advertise a judgement the product
// refuses to make.
const POOL = [
  { t: "NVDA", src: "Market wire", h: "Data center revenue guidance raised for next quarter", sum: "Guidance raised for next quarter. The size of the raise is not stated." },
  { t: "SPY", src: "Rates desk", h: "10 year Treasury yield falls to 3.9% after soft auction", sum: "The 10 year yield closed at 3.9% after a soft auction." },
  { t: "TSLA", src: "Autos", h: "Quarterly deliveries come in 6% under estimates", sum: "Deliveries came in 6% below estimates. No cause given." },
  { t: "AAPL", src: "Tech", h: "Services revenue hits a record, hardware flat", sum: "Services at a record, hardware flat quarter on quarter." },
  { t: "QQQ", src: "Macro", h: "Core inflation cools for a third straight month", sum: "Core inflation fell for a third month. The figure is not given." },
  { t: "AMZN", src: "Retail", h: "Cloud unit margins slip on heavy AI spending", sum: "Cloud margins fell as AI spending rose. Sizes not given." },
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
        <h3 className="t-subtitle text-ink">Read the morning in one pass.</h3>
        <p className="mt-4 text-[14.5px] leading-relaxed text-steel">
          Every headline comes with the short summary its source published, with that source named beside it. New stories arrive as
          they break.
        </p>
        <p className="mt-5 border-l border-line pl-4 text-[13px] leading-relaxed text-steel">
          No bull or bear label, on purpose. The summary restates what the source says and stops there. Deciding whether a headline
          is good or bad is your call, not the machine&rsquo;s.
        </p>
      </div>

      <div className="flex min-h-[460px] min-w-0 flex-col gap-3 lg:col-span-8" data-testid="demo-news-feed">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((n) => (
            <motion.article
              key={n.key}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="well p-5"
              data-testid="demo-news-item"
            >
              <div className="flex items-center gap-3 text-[12px] text-steel">
                <span className="num font-medium text-ink">{n.t}</span>
                <span>{n.src}</span>
                <span className="num ml-auto">{n.time}</span>
              </div>
              <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{n.h}</p>
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                <span className="shrink-0 text-[12px] font-medium text-mint">Source summary</span>
                <span className="text-[13px] leading-relaxed text-ink/90">{n.sum}</span>
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
