import { useEffect, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { Logo } from "@/components/site/Logo";
import { scrollToId, openApp } from "@/lib/site";

export const NAV_LINKS = [
  { id: "home", label: "Home" },
  { id: "how-it-works", label: "How It Works" },
  { id: "features", label: "Features" },
  { id: "contact", label: "Contact" },
];

export const Nav = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id) => {
    setOpen(false);
    scrollToId(id);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6" data-testid="site-nav">
      <motion.div className="scroll-progress" style={{ scaleX: progress }} data-testid="scroll-progress" />
      <motion.nav
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className={`glass mx-auto flex h-[68px] max-w-desk items-center justify-between rounded-full pl-6 pr-2 transition-[border-color,box-shadow] duration-300 ${scrolled ? "border-white/[0.14] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]" : ""}`}
      >
        <button onClick={() => go("home")} className="text-[28px] sm:text-[30px]" data-testid="nav-logo-link" aria-label="TickSPY home">
          <Logo testId="nav-logo" />
        </button>
        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.id}>
              <button onClick={() => go(l.id)} data-testid={`nav-link-${l.id}`} className="group relative rounded-full px-4 py-2 text-[14px] font-medium text-steel transition-colors duration-200 hover:text-ink">
                {l.label}
                <span className="absolute inset-x-4 -bottom-0.5 h-px origin-left scale-x-0 bg-mint transition-transform duration-300 ease-out group-hover:scale-x-100" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <button className="btn btn-solid btn-sm" onClick={openApp} data-testid="nav-open-app-button">Open App</button>
          <button className="grid h-10 w-10 place-items-center rounded-full border border-white/10 md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open} data-testid="nav-menu-toggle">
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d={open ? "M4 4l12 12M16 4L4 16" : "M3 7h14M3 13h9"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </motion.nav>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="glass mx-auto mt-2 max-w-desk p-2 md:hidden"
            data-testid="nav-mobile-menu"
          >
            {NAV_LINKS.map((l, i) => (
              <motion.button
                key={l.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i }}
                onClick={() => go(l.id)}
                data-testid={`nav-mobile-link-${l.id}`}
                className="block w-full rounded-xl px-4 py-3 text-left text-[15px] text-ink hover:bg-white/5"
              >
                {l.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
