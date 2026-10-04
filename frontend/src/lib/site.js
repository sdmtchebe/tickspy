import Lenis from "lenis";
import { toast } from "sonner";

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
  else el.scrollIntoView({ behavior: "smooth" });
}

// The desk is bundled into this site at <base>/desk/index.html (a copy of
// desk/index.html added by scripts/sync-desk.js). PUBLIC_URL is the site's base
// path, so this resolves correctly at a domain root, under a subpath such as
// /tickspy/ on GitHub Pages, and in local dev. Override with REACT_APP_DESK_PATH
// to point anywhere else.
const DESK_PATH = process.env.REACT_APP_DESK_PATH || `${process.env.PUBLIC_URL || ""}/desk/index.html`;

export function openApp() {
  const win = window.open(DESK_PATH, "_blank", "noopener,noreferrer");
  if (!win) {
    // Pop-up blocked: fall back to opening the desk in this tab.
    toast("Opening the TickSPY desk…", { description: "Pop-ups are blocked, so we opened it in this tab." });
    window.location.assign(DESK_PATH);
  }
}
