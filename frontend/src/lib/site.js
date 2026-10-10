import Lenis from "lenis";

let lenis = null;

export function startLenis() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
  let raf = 0;
  const loop = (time) => {
    lenis?.raf(time);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    lenis?.destroy();
    lenis = null;
  };
}

export function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: -72 });
  else el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// The desk is bundled into this site at <base>/desk/index.html (a copy of
// desk/index.html added by scripts/sync-desk.js). package.json sets
// "homepage": ".", so PUBLIC_URL is "." and this stays a relative link — it
// resolves at a domain root, under a subpath such as /tickspy/ on GitHub Pages,
// in local dev, and even when the built folder is opened straight from disk.
// Override with REACT_APP_DESK_PATH to point anywhere else.
export const DESK_PATH = process.env.REACT_APP_DESK_PATH || `${process.env.PUBLIC_URL || ""}/desk/index.html`;
// Native links open exactly one tab and support keyboard / modifier clicks.
// window.open(..., 'noopener') can return null even when it succeeds; never
// treat that return value as a reason to perform a second navigation.
