import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";

/*
 * Motion vocabulary for the landing page.
 *
 * Two rules shape everything here:
 *
 *   1. Nothing animates its own sharpness. Blur-in reveals are the single most
 *      recognisable generated-page tell, and they also make text unreadable
 *      for the first third of a second, which is exactly when a visitor is
 *      deciding whether to keep reading.
 *   2. Distance is small. A reveal travels 10px, once, in half a second. There
 *      is no rotation, no scale, and no stagger longer than a quarter second.
 */

const EASE = [0.22, 1, 0.36, 1];

/** Fade and lift 10px as the element enters. The page's only entrance. */
export const Reveal = ({ children, delay = 0, className = "", amount = 0.25, ...rest }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 10 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount }}
    transition={{ duration: 0.55, delay, ease: EASE }}
    {...rest}
  >
    {children}
  </motion.div>
);

/** Group reveal for a list or a row of cards. Same 10px, staggered 60ms. */
export const group = (step = 0.06) => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: 0.04 } },
});

export const groupItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/** Fade only, for panels whose position is already doing the work. */
export const Soften = ({ children, delay = 0, className = "", amount = 0.2 }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0 }}
    whileInView={{ opacity: 1 }}
    viewport={{ once: true, amount }}
    transition={{ duration: 0.6, delay, ease: EASE }}
  >
    {children}
  </motion.div>
);

/**
 * Scroll-linked drift for the hero only. Kept to a few tens of pixels and
 * passed through a stiff spring so it tracks the pointer-free gesture without
 * lagging behind it.
 */
export const Parallax = ({ children, range = 40, className = "" }) => {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useSpring(useTransform(scrollYProgress, [0, 1], [0, range]), {
    stiffness: 140,
    damping: 30,
    restDelta: 0.5,
  });
  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
};
