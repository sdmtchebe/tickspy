import { useEffect, useState } from "react";
import { Info, TONE } from "@/components/site/bits";
import { INDICATORS, jitterValues } from "@/lib/indicators";

/*
 * The live board of the 14 indicators the desk tracks. Each row carries a tone
 * dot, the reading, and a plain English tooltip.
 *
 * Rows are hairline-separated lines of a table rather than fourteen little
 * cards: fourteen floating panels is a wall of boxes, and it makes the values
 * harder to compare down a column, which is the only thing this board is for.
 */
export const IndicatorBoard = ({ active, onTick }) => {
  const [vals, setVals] = useState(() => INDICATORS.map((i) => i.base));
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setVals((vs) => {
        const next = vs.map((v, i) => jitterValues(INDICATORS[i], v));
        onTick?.(next);
        return next;
      });
    }, 1900);
    return () => clearInterval(id);
  }, [active, onTick]);

  return (
    <div className="well p-4" data-testid="indicator-board">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <span className="text-[12.5px] text-steel">14 indicators, SPY · 1 min</span>
        <span className="flex items-center gap-2 text-[12px] text-steel">
          <span className="live-dot" aria-hidden="true" />
          live
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {INDICATORS.map((ind, i) => {
          const tone = TONE[ind.tone(vals[i])];
          /* Ruled rows, with the rule removed from the final row. Two columns
             means the final row is the last TWO items, so the single-column
             `last:` rule is joined by one that strips the pair on wider
             screens — otherwise the 13th row keeps a rule that nothing above
             or beside it lines up with. */
          return (
            <li
              key={ind.id}
              className="border-b border-line py-2.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
              data-testid={`indicator-${ind.id}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-steel">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.hex }} aria-hidden="true" />
                  <span className="truncate">{ind.name}</span>
                </span>
                <Info id={`ind-${ind.id}`} text={ind.tip} align={i % 2 === 0 ? "left" : "right"} />
              </div>
              <div className={`num mt-1.5 text-[13px] ${tone.text}`}>
                <span key={vals[i][0]} className="num-in">
                  {ind.fmt(vals[i])}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
