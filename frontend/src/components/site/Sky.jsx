import { motion, useScroll, useTransform } from "framer-motion";

/*
 * The backdrop is one thing doing one job: a quiet depth behind a dark page so
 * the panels have something to sit on. It is deliberately almost empty.
 *
 * The background stays sparse: a faint field of stars and a few drifting
 * candlestick constellations. They are atmosphere, not an interactive chart.
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

const CANDLE_CLUSTERS = [
  {
    top: "16%",
    left: "5%",
    scale: 0.9,
    rotate: -8,
    duration: "19s",
    delay: "-7s",
    candles: [
      [0, 26, 8, "up"], [14, 42, 13, "down"], [29, 21, 6, "up"],
      [42, 34, 18, "up"], [57, 18, 7, "down"], [70, 30, 11, "up"],
    ],
  },
  {
    top: "43%",
    left: "75%",
    scale: 0.72,
    rotate: 11,
    duration: "23s",
    delay: "-14s",
    candles: [
      [0, 18, 7, "down"], [13, 31, 15, "up"], [28, 24, 10, "up"],
      [42, 44, 21, "down"], [57, 27, 12, "up"], [72, 19, 6, "down"],
    ],
  },
  {
    top: "76%",
    left: "30%",
    scale: 0.8,
    rotate: -5,
    duration: "26s",
    delay: "-18s",
    candles: [
      [0, 22, 9, "up"], [15, 17, 6, "down"], [29, 38, 17, "up"],
      [44, 25, 12, "down"], [59, 33, 14, "up"], [74, 20, 8, "up"],
    ],
  },
];

export const Sky = () => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -90]);

  /* Deliberately no opaque background on the layer below. It used to paint
     bg-void over the whole viewport, which hid the body's own scrolling gradient
     completely — the page only ever showed the fixed washes. Letting the body
     show through is what makes the tone move as you scroll. */
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true" data-testid="backdrop">
      {/* Two light sources, not one: the accent over the hero, and a cooler
          slate from the top right. Two off-centre lights are what stop the top
          of the page reading as a flat black rectangle. */}
      <div
        className="absolute left-1/2 top-0 h-[46vh] w-[130vw] -translate-x-1/2"
        style={{ background: "radial-gradient(58% 100% at 50% 0%, rgba(0,229,160,0.11), transparent 72%)" }}
      />
      <div
        className="absolute right-0 top-0 h-[64vh] w-[72vw]"
        style={{ background: "radial-gradient(70% 90% at 100% 0%, rgba(126,152,196,0.12), transparent 74%)" }}
      />
      {/* A horizon along the bottom of the viewport, so the field has a near and
          a far instead of fading to the same black in every direction. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[34vh]"
        style={{ background: "linear-gradient(0deg, rgba(120,142,180,0.09), transparent)" }}
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
      <div className="cosmic-candles" aria-hidden="true">
        {CANDLE_CLUSTERS.map((cluster) => (
          <div
            key={`${cluster.top}-${cluster.left}`}
            className="cosmic-candle-cluster"
            style={{
              top: cluster.top,
              left: cluster.left,
              "--candle-scale": cluster.scale,
              "--candle-rotate": `${cluster.rotate}deg`,
              "--candle-duration": cluster.duration,
              "--candle-delay": cluster.delay,
            }}
          >
            {cluster.candles.map(([left, top, height, tone]) => (
              <span
                key={`${left}-${top}`}
                className={`cosmic-candle cosmic-candle-${tone}`}
                style={{ left: `${left}px`, top: `${top}px`, height: `${height}px` }}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Grain goes on last, over the washes and the stars, so everything sits in
          one material rather than floating on it. */}
      <div className="grain absolute inset-0" />
    </div>
  );
};
