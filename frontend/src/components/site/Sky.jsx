import { motion, useScroll, useTransform } from "framer-motion";

/*
 * The backdrop is one thing doing one job: a quiet depth behind a dark page so
 * the panels have something to sit on. It is deliberately almost empty.
 *
 * An earlier version layered three blurred aurora blobs, three twinkling star
 * planes, nine shooting stars, a perspective grid and six drifting candlestick
 * "constellations" on top of each other. Every one of them was individually
 * defensible and together they were noise, so the animated candlesticks, the
 * shooting stars, the grid and the colour wash are gone. What is left is a
 * faint field of stars that drifts a little as you scroll.
 */

const STARS = [
  { top: "12%", left: "18%", size: 1, opacity: 0.5 },
  { top: "22%", left: "76%", size: 1.5, opacity: 0.7 },
  { top: "38%", left: "9%", size: 1, opacity: 0.35 },
  { top: "46%", left: "63%", size: 1, opacity: 0.45 },
  { top: "58%", left: "31%", size: 1.5, opacity: 0.55 },
  { top: "67%", left: "88%", size: 1, opacity: 0.3 },
  { top: "74%", left: "47%", size: 1, opacity: 0.45 },
  { top: "83%", left: "14%", size: 1.5, opacity: 0.35 },
  { top: "91%", left: "69%", size: 1, opacity: 0.3 },
  { top: "31%", left: "42%", size: 1, opacity: 0.28 },
  { top: "6%", left: "55%", size: 1, opacity: 0.35 },
  { top: "52%", left: "94%", size: 1, opacity: 0.25 },
];

export const Sky = () => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -90]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-void" aria-hidden="true" data-testid="backdrop">
      {/* Two light sources, not one: the accent over the hero, and a cooler
          slate from the top right. Two off-centre lights are what stop the top
          of the page reading as a flat black rectangle. */}
      <div
        className="absolute left-1/2 top-0 h-[46vh] w-[130vw] -translate-x-1/2"
        style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(0,229,160,0.055), transparent 70%)" }}
      />
      <div
        className="absolute right-0 top-0 h-[64vh] w-[72vw]"
        style={{ background: "radial-gradient(70% 90% at 100% 0%, rgba(126,152,196,0.06), transparent 72%)" }}
      />
      {/* A horizon along the bottom of the viewport, so the field has a near and
          a far instead of fading to the same black in every direction. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[34vh]"
        style={{ background: "linear-gradient(0deg, rgba(120,142,180,0.05), transparent)" }}
      />
      <motion.div className="absolute inset-0" style={{ y }}>
        {STARS.map((s) => (
          <span
            key={`${s.top}-${s.left}`}
            className="absolute rounded-full bg-white"
            style={{ top: s.top, left: s.left, width: s.size, height: s.size, opacity: s.opacity }}
          />
        ))}
      </motion.div>
      {/* Grain goes on last, over the washes and the stars, so everything sits in
          one material rather than floating on it. */}
      <div className="grain absolute inset-0" />
    </div>
  );
};
