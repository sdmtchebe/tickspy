import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "@/components/site/Logo";
import { scrollToId, openApp } from "@/lib/site";

/* Ordered the way the page reads. */
export const NAV_LINKS = [
  { id: "home", label: "Home" },
  { id: "demo", label: "The desk" },
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How it works" },
  { id: "setup", label: "Setup" },
  { id: "contact", label: "Contact" },
];

export const Nav = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id) => {
    setOpen(false);
    scrollToId(id);
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200 ${
        scrolled ? "border-line bg-void/85 backdrop-blur-md" : "border-transparent"
      }`}
      data-testid="site-nav"
    >
      <nav className="shell flex h-16 items-center justify-between gap-6">
        <button onClick={() => go("home")} className="text-[26px]" data-testid="nav-logo-link" aria-label="TickSPY home">
          <Logo testId="nav-logo" />
        </button>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.filter((l) => l.id !== "home").map((l) => (
            <li key={l.id}>
              <button
                onClick={() => go(l.id)}
                data-testid={`nav-link-${l.id}`}
                className="rounded-lg px-3 py-2 text-[14px] text-steel transition-colors duration-150 hover:text-ink"
              >
                {l.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <button className="btn btn-solid btn-sm" onClick={openApp} data-testid="nav-open-app-button">
            Open desk
          </button>
          <button
            className="btn btn-quiet grid h-9 w-9 place-items-center !px-0 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
            data-testid="nav-menu-toggle"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d={open ? "M4 4l12 12M16 4L4 16" : "M3 7h14M3 13h14"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-line bg-surface lg:hidden"
            data-testid="nav-mobile-menu"
          >
            <div className="shell py-2">
              {NAV_LINKS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => go(l.id)}
                  data-testid={`nav-mobile-link-${l.id}`}
                  className="block w-full rounded-lg px-3 py-3 text-left text-[15px] text-ink transition-colors hover:bg-surface2"
                >
                  {l.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
