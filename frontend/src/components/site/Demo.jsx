import { useState } from "react";
import { motion } from "framer-motion";
import { DemoChart } from "@/components/site/DemoChart";
import { DemoNews } from "@/components/site/DemoNews";
import { DemoVolatility } from "@/components/site/DemoVolatility";
import { DemoAlerts } from "@/components/site/DemoAlerts";
import { Reveal, SplitWords } from "@/components/site/motion";

const TABS = [
  { id: "chart", label: "Chart Analysis" },
  { id: "news", label: "News & AI Overview" },
  { id: "volatility", label: "Volatility Model" },
  { id: "alerts", label: "Alerts & Indicators" },
];

const Panel = ({ active, children, id }) => (
  <motion.div
    role="tabpanel"
    aria-hidden={!active}
    data-testid={`demo-panel-${id}`}
    initial={false}
    animate={{ opacity: active ? 1 : 0, y: active ? 0 : 10 }}
    transition={{ duration: 0.3, ease: "easeOut" }}
    style={{ gridArea: "1 / 1", minWidth: 0, pointerEvents: active ? "auto" : "none", visibility: active ? "visible" : "hidden", transitionProperty: "visibility", transitionDelay: active ? "0s" : "0.3s" }}
  >
    {children}
  </motion.div>
);

export const Demo = () => {
  const [tab, setTab] = useState("chart");
  return (
    <section id="demo" className="section-pad relative z-10" data-testid="demo-section">
      <div className="mx-auto max-w-desk px-6">
        <div className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SplitWords text="The desk in action." accent={["action"]} className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl" />
          <Reveal delay={0.25}><p className="max-w-[420px] text-base text-steel md:text-lg">Click through the four views. Everything here runs on demo data, but it moves the way the real desk does.</p></Reveal>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.96, filter: "blur(10px)" }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="glass rounded-[28px] p-3 sm:p-4">
            <div className="flex items-center gap-2 overflow-x-auto rounded-[20px] border hairline bg-[#070A14]/60 p-1.5" role="tablist" data-lenis-prevent>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  data-testid={`demo-tab-${t.id}`}
                  className={`relative shrink-0 rounded-2xl px-5 py-3 text-[14px] font-medium transition-colors duration-200 ${tab === t.id ? "text-ink" : "text-steel hover:text-ink"}`}
                >
                  {tab === t.id && <motion.span layoutId="demo-tab-pill" className="absolute inset-0 rounded-2xl border border-white/10 bg-white/[0.06]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <span className="relative flex items-center gap-2">
                    {tab === t.id && <span className="h-1.5 w-1.5 rounded-full bg-mint" />}
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 p-3 pt-6 sm:p-6">
              <Panel id="chart" active={tab === "chart"}><DemoChart /></Panel>
              <Panel id="news" active={tab === "news"}><DemoNews active={tab === "news"} /></Panel>
              <Panel id="volatility" active={tab === "volatility"}><DemoVolatility active={tab === "volatility"} /></Panel>
              <Panel id="alerts" active={tab === "alerts"}><DemoAlerts active={tab === "alerts"} /></Panel>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
