import { useState } from "react";
import { CandleChart } from "@/components/site/CandleChart";
import { Num, Info, scoreTone, TONE } from "@/components/site/bits";
import { TICKERS, fmt } from "@/lib/market";

const readouts = (s) => [
  { id: "atr", k: "ATR 14", v: `$${fmt(s.atr)}`, tip: `ATR 14: Average true range across the last 14 bars — the usual measure of how far price travels in one bar. $${fmt(s.atr)} is a typical single-bar swing at this interval, not a prediction.` },
  { id: "vwap", k: "VWAP", v: fmt(s.vwap), c: "text-amber", tip: `VWAP: The average price paid today, weighted by volume. Price is currently ${s.price > s.vwap ? "above" : "below"} it.` },
  { id: "bb", k: "Bollinger %B", v: fmt(s.pctB), tip: `%B: Where price sits inside its normal range. 0 = bottom band, 1 = top band. ${fmt(s.pctB)} means ${s.pctB > 0.8 ? "price is near the top of its recent range" : s.pctB < 0.2 ? "price is near the bottom of its recent range" : "price is in the middle of its range"}.` },
  { id: "volume", k: "Volume, 20 bars", v: `${(s.volume / 1000).toFixed(1)}K`, tip: "Volume: How many shares changed hands across the last 20 candles. Bars under the chart show each one." },
];

export const DemoChart = () => {
  const [sym, setSym] = useState("SPY");
  const [s, setS] = useState(null);
  const tone = TONE[scoreTone(s?.score ?? 50)];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TICKERS).map((t) => (
              <button
                key={t}
                onClick={() => setSym(t)}
                data-testid={`demo-ticker-${t.toLowerCase()}`}
                className={`num rounded-lg border px-3.5 py-1.5 text-[13px] transition-colors duration-150 ${
                  sym === t ? "border-mint/50 bg-mint/10 text-mint" : "border-line text-steel hover:border-white/20 hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="ml-auto hidden items-center gap-4 text-[12px] text-steel sm:flex">
            <span className="flex items-center gap-2"><span className="h-px w-4 bg-amber" aria-hidden="true" />VWAP</span>
            <span className="flex items-center gap-2"><span className="h-px w-4 bg-ink/50" aria-hidden="true" />Bollinger</span>
          </span>
        </div>
        <div className="well h-[320px] overflow-hidden sm:h-[400px]">
          <CandleChart key={sym} symbol={sym} bands vwap volume onUpdate={setS} testId="demo-candle-chart" />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
        <div className="well p-5">
          <div className="text-[12.5px] text-steel">{TICKERS[sym].name}</div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <Num value={fmt(s?.price ?? 0)} className="text-[30px] leading-none text-ink" testId="demo-price" />
            <span className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${tone.border} ${tone.bg} ${tone.text}`} data-testid="demo-score">
              {tone.label} {s?.score ?? 50}
            </span>
          </div>
        </div>

        {s &&
          readouts(s).map((r) => (
            <div key={r.id} className="well flex items-center justify-between gap-4 px-4 py-3.5" data-testid={`demo-readout-${r.id}`}>
              <div className="min-w-0">
                <div className="text-[12.5px] text-steel">{r.k}</div>
                <Num value={r.v} className={`text-[17px] ${r.c ?? "text-ink"}`} />
              </div>
              <Info id={r.id} text={r.tip} />
            </div>
          ))}
      </div>
    </div>
  );
};
