import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "@/components/site/Logo";
import { scrollToId, DESK_PATH } from "@/lib/site";
import { LANGUAGES, useLocale } from "@/lib/i18n";

/* Ordered the way the page reads. */
export const NAV_LINKS = [
  { id: "home", index: 0 },
  { id: "demo", index: 1 },
  { id: "features", index: 2 },
  { id: "how-it-works", index: 3 },
  { id: "setup", index: 4 },
  { id: "contact", index: 5 },
];

export const Nav = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { locale, setLocale, copy } = useLocale();

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
      <nav aria-label="Main navigation" className="shell flex h-16 items-center justify-between gap-6 lg:h-[84px]">
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
                 {copy.nav[l.index]}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
           <label className="sr-only" htmlFor="language-selector">{copy.language}</label>
           <select id="language-selector" className="language-select" value={locale} onChange={(event) => setLocale(event.target.value)} data-testid="language-selector">
             {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
           </select>
           <a className="btn btn-solid btn-sm" href={DESK_PATH} target="_blank" rel="noopener noreferrer" data-testid="nav-open-app-button">
             {copy.openDesk}
          </a>
          <button
            className="btn btn-quiet grid h-9 w-9 place-items-center !px-0 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={copy.menu}
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
                   {copy.nav[l.index]}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};
