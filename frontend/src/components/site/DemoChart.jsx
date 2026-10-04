import { useState } from "react";
import { CandleChart } from "@/components/site/CandleChart";
import { Num, Info, scoreTone, TONE } from "@/components/site/bits";
import { TICKERS, fmt } from "@/lib/market";

const readouts = (s) => [
  { id: "atr", k: "ATR 14", v: `$${fmt(s.atr)}`, tip: `ATR 14: Average price swing over 14 days. $${fmt(s.atr)} means the stock typically moves about $${fmt(s.atr)} per day.` },
  { id: "vwap", k: "VWAP", v: fmt(s.vwap), c: "text-amber", tip: `VWAP: The average price paid today, weighted by volume. Price is ${s.price > s.vwap ? "above" : "below"} it, so buyers are ${s.price > s.vwap ? "in control" : "losing ground"} for now.` },
  { id: "bb", k: "Bollinger %B", v: fmt(s.pctB), tip: `%B: Where price sits inside its normal range. 0 is the bottom band, 1 is the top. ${fmt(s.pctB)} means ${s.pctB > 0.8 ? "it is stretched high" : s.pctB < 0.2 ? "it is stretched low" : "it is in the middle of its range"}.` },
  { id: "volume", k: "Volume, 20 bars", v: `${(s.volume / 1000).toFixed(1)}K`, tip: "Volume: How many shares changed hands across the last 20 candles. Bars under the chart show each one." },
];

export const DemoChart = () => {
  const [sym, setSym] = useState("SPY");
  const [s, setS] = useState(null);
  const tone = TONE[scoreTone(s?.score ?? 50)];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
          {Object.keys(TICKERS).map((t) => (
            <button key={t} onClick={() => setSym(t)} data-testid={`demo-ticker-${t.toLowerCase()}`}
              className={`num rounded-full border px-4 py-1.5 text-[13px] transition-colors duration-200 ${sym === t ? "border-mint/50 bg-mint/10 text-mint" : "border-white/10 text-steel hover:text-ink"}`}>
              {t}
            </button>
          ))}
          </div>
          <span className="ml-auto hidden items-center gap-4 text-[12px] text-steel sm:flex">
            <span className="flex items-center gap-2"><span className="h-px w-4 bg-amber" />VWAP</span>
            <span className="flex items-center gap-2"><span className="h-px w-4 bg-ink/50" />Bollinger</span>
          </span>
        </div>
        <div className="h-[320px] rounded-2xl border hairline bg-[#070A14]/60 sm:h-[400px]">
          <CandleChart key={sym} symbol={sym} bands vwap volume onUpdate={setS} testId="demo-candle-chart" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
        <div className="glass-inner rounded-2xl p-5">
          <div className="text-[12px] text-steel">{TICKERS[sym].name}</div>
          <div className="mt-2 flex items-end justify-between">
            <Num value={fmt(s?.price ?? 0)} className="text-[30px] leading-none text-ink" testId="demo-price" />
            <span className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${tone.border} ${tone.bg} ${tone.text}`} data-testid="demo-score">
              {tone.label} {s?.score ?? 50}
            </span>
          </div>
        </div>
        {s && readouts(s).map((r) => (
          <div key={r.id} className="flex items-center justify-between glass-inner rounded-2xl px-5 py-4" data-testid={`demo-readout-${r.id}`}>
            <div>
              <div className="text-[12px] text-steel">{r.k}</div>
              <Num value={r.v} className={`text-[17px] ${r.c ?? "text-ink"}`} />
            </div>
            <Info id={r.id} text={r.tip} />
          </div>
        ))}
      </div>
    </div>
  );
};
