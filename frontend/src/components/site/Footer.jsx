import { Logo } from "@/components/site/Logo";
import { NAV_LINKS } from "@/components/site/Nav";
import { scrollToId } from "@/lib/site";

export const Footer = () => (
  <footer className="relative z-10 px-4 pb-6 sm:px-6" data-testid="site-footer">
    <div className="glass mx-auto flex max-w-desk flex-col gap-8 rounded-[24px] px-6 py-8 md:flex-row md:items-center md:justify-between md:px-10">
      <div>
        <Logo className="text-[30px]" testId="footer-logo" />
        <p className="mt-3 text-[13px] text-steel">© 2026 TickSPY. Demo data on this page. Not financial advice. Charts rendered by our own engine.</p>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {NAV_LINKS.map((l) => (
          <li key={l.id}>
            <button onClick={() => scrollToId(l.id)} className="text-[14px] text-steel transition-colors hover:text-ink" data-testid={`footer-link-${l.id}`}>{l.label}</button>
          </li>
        ))}
      </ul>
    </div>
  </footer>
);
