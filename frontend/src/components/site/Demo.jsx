import { useState } from "react";
import { motion } from "framer-motion";
import { DemoChart } from "@/components/site/DemoChart";
import { DemoNews } from "@/components/site/DemoNews";
import { DemoVolatility } from "@/components/site/DemoVolatility";
import { DemoAlerts } from "@/components/site/DemoAlerts";
import { Reveal } from "@/components/site/motion";

const TABS = [
  { id: "chart", label: "Chart analysis" },
  { id: "news", label: "News & overview" },
  { id: "volatility", label: "Volatility" },
  { id: "alerts", label: "Alerts & indicators" },
];

const Panel = ({ active, children, id }) => (
  <motion.div
    role="tabpanel"
    aria-hidden={!active}
    data-testid={`demo-panel-${id}`}
    initial={false}
    animate={{ opacity: active ? 1 : 0, y: active ? 0 : 8 }}
    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    style={{ gridArea: "1 / 1", minWidth: 0, pointerEvents: active ? "auto" : "none", visibility: active ? "visible" : "hidden", transitionProperty: "visibility", transitionDelay: active ? "0s" : "0.28s" }}
  >
    {children}
  </motion.div>
);

/*
 * The tour. This sits above the feature list on purpose: one panel a visitor
 * can click through is worth more than six cards describing it.
 */
export const Demo = () => {
  const [tab, setTab] = useState("chart");
  return (
    <section id="demo" className="section-pad relative z-10" data-testid="demo-section">
      <div className="shell">
        <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="t-label">The desk</p>
            <h2 className="t-title mt-3 text-ink">
              <span className="acc">Four views</span> of the same market.
            </h2>
          </div>
          <Reveal delay={0.1}>
            <p className="max-w-[430px] text-[15px] leading-relaxed text-steel lg:pb-2">
              Click through them. Every figure on this page is generated in your browser from a simulated series, so it moves the
              way the real desk moves without pretending to be today&rsquo;s quote.
            </p>
          </Reveal>
        </div>

        <Reveal amount={0.08}>
          <div className="panel p-2 sm:p-3">
            <div
              className="flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-well p-1"
              role="tablist"
              data-lenis-prevent
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  data-testid={`demo-tab-${t.id}`}
                  className={`relative shrink-0 rounded-md px-4 py-2.5 text-[13.5px] font-medium transition-colors duration-150 ${
                    tab === t.id ? "text-ink" : "text-steel hover:text-ink"
                  }`}
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="demo-tab-pill"
                      className="absolute inset-0 rounded-md border border-line bg-surface2"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{t.label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 p-3 pt-6 sm:p-5 sm:pt-7">
              <Panel id="chart" active={tab === "chart"}><DemoChart /></Panel>
              <Panel id="news" active={tab === "news"}><DemoNews active={tab === "news"} /></Panel>
              <Panel id="volatility" active={tab === "volatility"}><DemoVolatility active={tab === "volatility"} /></Panel>
              <Panel id="alerts" active={tab === "alerts"}><DemoAlerts active={tab === "alerts"} /></Panel>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
};
