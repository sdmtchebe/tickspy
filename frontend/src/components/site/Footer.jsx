import { Logo } from "@/components/site/Logo";
import { NAV_LINKS } from "@/components/site/Nav";
import { scrollToId, openApp } from "@/lib/site";

export const Footer = () => (
  <footer className="relative z-10 mt-8 border-t border-line" data-testid="site-footer">
    <div className="shell grid gap-10 py-14 md:grid-cols-12">
      <div className="md:col-span-5">
        <Logo className="text-[28px]" testId="footer-logo" />
        <p className="mt-4 max-w-[380px] text-[13.5px] leading-relaxed text-steel">
          A free trading desk for people who want the number and the sentence that explains it. The charts on this page are drawn
          from a simulated series; the desk runs on real market data.
        </p>
      </div>

      <nav className="md:col-span-3" aria-label="Sections">
        <p className="t-label">Sections</p>
        <ul className="mt-4 space-y-2.5">
          {NAV_LINKS.map((l) => (
            <li key={l.id}>
              <button onClick={() => scrollToId(l.id)} className="link-quiet text-[14px]" data-testid={`footer-link-${l.id}`}>
                {l.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="md:col-span-4">
        <p className="t-label">The desk</p>
        <ul className="mt-4 space-y-2.5">
          <li>
            <button onClick={openApp} className="link-quiet text-[14px]">
              Open the desk
            </button>
          </li>
          <li>
            <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer" className="link-quiet text-[14px]">
              Alpaca (free market data keys)
            </a>
          </li>
        </ul>
        <p className="mt-6 text-[12.5px] leading-relaxed text-faint">
          TickSPY is not a broker and places no trades. It publishes analysis, not advice, and its volatility model estimates how
          large a move may be rather than which way it will go. Full disclosures sit inside the desk.
        </p>
      </div>
    </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-2 py-6 text-[12.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 TickSPY</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="privacy.html" className="link-quiet">Privacy and cookies</a>
            <p>No accounts, no server of ours holding your keys.</p>
          </div>
        </div>
      </div>
  </footer>
);
