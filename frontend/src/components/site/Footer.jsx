import { Logo } from "@/components/site/Logo";
import { NAV_LINKS } from "@/components/site/Nav";
import { scrollToId, DESK_PATH } from "@/lib/site";
import { useLocale } from "@/lib/i18n";

export const Footer = () => {
  const { copy } = useLocale();
  return (
    <footer className="relative z-10 mt-8 border-t border-line" data-testid="site-footer">
    <div className="shell grid gap-10 py-14 md:grid-cols-12">
      <div className="md:col-span-5">
        <Logo testId="footer-logo" />
        <p className="mt-4 max-w-[380px] text-[13.5px] leading-relaxed text-steel">
          A free trading desk for people who want the number and the sentence that explains it. The charts on this page are drawn
          from a simulated series. With no account the desk replays a bundled sample session, labelled on screen as generated
          demonstration data rather than real market prices; add your own free Alpaca keys for current data.
        </p>
      </div>

      <nav className="md:col-span-3" aria-label="Sections">
        <p className="t-label">Sections</p>
        <ul className="mt-4 space-y-2.5">
          {NAV_LINKS.map((l) => (
            <li key={l.id}>
              <button onClick={() => scrollToId(l.id)} className="link-quiet text-[14px]" data-testid={`footer-link-${l.id}`}>
                {copy.nav[l.index]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="md:col-span-4">
        <p className="t-label">The desk</p>
        <ul className="mt-4 space-y-2.5">
          <li>
            <a href={DESK_PATH} target="_blank" rel="noopener noreferrer" className="link-quiet text-[14px]">
              Open the desk
            </a>
          </li>
          <li>
            <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer" className="link-quiet text-[14px]">
              Alpaca (free market data keys)
            </a>
          </li>
          <li>
            <a href="https://buymeacoffee.com/tickspy" target="_blank" rel="noopener noreferrer" className="link-quiet text-[14px]" data-testid="footer-coffee">
              Buy me a coffee
            </a>
          </li>
        </ul>
        <p className="mt-6 text-[12.5px] leading-relaxed text-faint">
          TickSPY is provided for <strong className="font-medium text-steel">educational and informational purposes only</strong>. It is
          not a broker or an adviser, it places no trades, and nothing here is financial, investment, trading or tax advice. It
          publishes analysis, not advice, and its volatility model estimates how large a move may be rather than which way it will
          go. See the <a href="risk.html" className="link-quiet underline underline-offset-2">Risk Disclosure</a> before making any decision.
        </p>
      </div>
    </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-2 py-6 text-[12.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Tickspycorp · Québec, Canada</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="privacy.html" className="link-quiet">Privacy policy</a>
            <a href="terms.html" className="link-quiet">Terms of service</a>
            <a href="risk.html" className="link-quiet">Risk disclosure</a>
            <a href="privacy-fr.html" lang="fr" hreflang="fr" className="link-quiet">Confidentialité&nbsp;(FR)</a>
            <a href="mailto:tickspysupport@gmail.com" className="link-quiet">Support</a>
            <a href="desk/overview/" className="link-quiet">Learn the desk</a>
            <a href="desk/tools/" className="link-quiet">Risk calculators</a>
            <a href="desk/volatility/" className="link-quiet">ATR and volatility</a>
            <p>No accounts, no server of ours holding your keys.</p>
          </nav>
        </div>
      </div>
    </footer>
  );
};
