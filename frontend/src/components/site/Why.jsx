import { motion } from "framer-motion";
import { ReticleMark } from "@/components/site/Logo";
import { SplitWords, stagger, item } from "@/components/site/motion";

const POINTS = [
  ["Free.", "No paywall, no trial, no upsell. The whole desk, for everyone."],
  ["Plain English next to every number.", "If you have to look it up, we wrote it badly."],
  ["Works with any US ticker.", "Not just the ten names everyone already watches."],
  ["We publish the unflattering parts too.", "Five years of 5-minute bars, measured against a naive baseline. The parts where the model barely beats the baseline are written down alongside the parts where it does well."],
];

export const Why = () => (
  <section className="section-pad relative z-10" data-testid="why-section">
    <div className="mx-auto max-w-desk px-6">
      <motion.div
        initial={{ opacity: 0, y: 50, filter: "blur(10px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative overflow-hidden rounded-[28px] p-8 sm:p-12 lg:p-16"
      >
        <motion.div
          className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 text-white/[0.05]"
          animate={{ rotate: 360 }}
          transition={{ duration: 90, ease: "linear", repeat: Infinity }}
          aria-hidden="true"
        >
          <ReticleMark accent="currentColor" className="h-full w-full" />
        </motion.div>
        <div className="grid gap-12 lg:grid-cols-12">
          <SplitWords text="Why TickSPY?" accent={["TickSPY"]} className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl lg:col-span-4" />
          <motion.ul variants={stagger(0.12)} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:col-span-8">
            {POINTS.map(([h, t], i) => (
              <motion.li variants={item} key={h} className="border-t hairline pt-6" data-testid={`why-point-${i + 1}`}>
                <span className="num text-[12px] text-mint">0{i + 1}</span>
                <p className="mt-3 font-display text-[20px] font-medium leading-snug tracking-[-0.015em] text-ink">{h}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-steel">{t}</p>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </motion.div>
    </div>
  </section>
);
