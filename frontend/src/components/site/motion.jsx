import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1];

/** Fade + rise + un-blur when scrolled into view. */
export const Reveal = ({ children, delay = 0, y = 28, className = "", once = true, amount = 0.2, ...rest }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y, filter: "blur(10px)" }}
    whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    viewport={{ once, amount }}
    transition={{ duration: 0.9, delay, ease: EASE }}
    {...rest}
  >
    {children}
  </motion.div>
);

/** Word-by-word masked heading reveal. Accepts a string or array of lines. */
const wordVariants = {
  hidden: { y: "110%", rotate: 4 },
  show: (d) => ({ y: 0, rotate: 0, transition: { duration: 0.9, delay: d, ease: EASE } }),
};

export const SplitWords = ({ text, className = "", as: Tag = "h2", accent = [], delay = 0, ...rest }) => {
  const lines = Array.isArray(text) ? text : [text];
  const MTag = motion[Tag] ?? motion.h2;
  let idx = 0;
  return (
    <MTag className={className} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.5 }} {...rest}>
      {lines.map((line, li) => (
        <span key={li} className="block">
          {line.split(" ").map((w) => {
            const i = idx++;
            const isAccent = accent.includes(w.replace(/[.,!?]/g, ""));
            return (
              <span key={`${li}-${i}`} className="inline-block overflow-hidden pb-[0.1em] -mb-[0.1em] align-bottom">
                <motion.span className={`inline-block ${isAccent ? "text-mint" : ""}`} variants={wordVariants} custom={delay + i * 0.06}>
                  {w}
                </motion.span>
                {"\u00A0"}
              </span>
            );
          })}
        </span>
      ))}
    </MTag>
  );
};

/** Scroll-linked parallax wrapper (moves `range` px across its viewport travel). */
export const Parallax = ({ children, range = 60, className = "", scale = false }) => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useSpring(useTransform(scrollYProgress, [0, 1], [range, -range]), { stiffness: 80, damping: 24, mass: 0.6 });
  const s = useTransform(scrollYProgress, [0, 0.5, 1], [0.96, 1, 0.98]);
  return (
    <motion.div ref={ref} style={{ y, scale: scale ? s : 1 }} className={className}>
      {children}
    </motion.div>
  );
};

/** Stagger container + item helpers. */
export const stagger = (step = 0.09) => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: 0.05 } },
});
export const item = {
  hidden: { opacity: 0, y: 24, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease: EASE } },
};
