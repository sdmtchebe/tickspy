const ITEMS = [
  ["SPY", "548.32", "+0.62%"], ["QQQ", "474.90", "+0.88%"], ["AAPL", "226.14", "-0.21%"], ["NVDA", "128.56", "+2.14%"],
  ["TSLA", "241.07", "-1.37%"], ["MSFT", "431.80", "+0.44%"], ["AMZN", "186.51", "+0.97%"], ["META", "529.18", "-0.36%"],
  ["IWM", "219.40", "+1.05%"], ["DIA", "412.66", "+0.18%"],
];

const Row = ({ hidden }) => (
  <div className="flex shrink-0 items-center" aria-hidden={hidden}>
    {ITEMS.map(([t, p, c], i) => (
      <div key={t} className="flex items-center gap-4 px-8">
        <span className="font-display text-[15px] font-semibold text-ink">{t}</span>
        <span className="num text-[14px] text-steel">{p}</span>
        <span className={`num text-[14px] ${c.startsWith("-") ? "text-bear" : "text-mint"}`}>{c}</span>
        {i % 3 === 2 && <span className="pl-8 font-display text-[15px] text-steel">Plain English next to every number</span>}
        <span className="ml-4 text-steel/50">/</span>
      </div>
    ))}
  </div>
);

export const Marquee = () => (
  <div className="marquee relative z-10 overflow-hidden border-y hairline bg-[rgba(12,16,32,0.55)] py-5" data-testid="ticker-marquee">
    <div className="marquee-track">
      <Row />
      <Row hidden />
    </div>
  </div>
);
