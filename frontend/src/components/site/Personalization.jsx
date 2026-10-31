import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { DESK_PATH } from "@/lib/site";
import {
  DEFAULT_WATCHLIST,
  DESK_TABS,
  MAX_WATCHLIST,
  TIMEFRAMES,
  addWatchlistSymbol,
  readDeskPrefs,
  readWatchlist,
  removeWatchlistSymbol,
  resetPersonalization,
  writeDeskPrefs,
} from "@/lib/personalization";

/*
 * The account-free personalization section.
 *
 * It writes the same two keys the desk already reads (`wl` and `deskprefs`),
 * so the promise is real: set a watchlist and an opening view here, then open
 * the desk and it is already there. No profile, no email, no server call.
 */
export const Personalization = () => {
  const [list, setList] = useState(DEFAULT_WATCHLIST);
  const [prefs, setPrefs] = useState({ symbol: "SPY", timeframe: "1Min", tab: "live" });
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setList(readWatchlist());
    setPrefs(readDeskPrefs());
  }, []);

  useEffect(() => {
    if (!saved) return undefined;
    const id = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(id);
  }, [saved]);

  const flash = () => setSaved(true);

  const add = () => {
    const result = addWatchlistSymbol(draft, list);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setList(result.list);
    setDraft("");
    if (!result.list.includes(prefs.symbol)) {
      setPrefs(writeDeskPrefs({ symbol: result.list[0] || prefs.symbol }));
    }
    flash();
  };

  const remove = (symbol) => {
    const next = removeWatchlistSymbol(symbol, list);
    setList(next);
    if (prefs.symbol === symbol) {
      setPrefs(writeDeskPrefs({ symbol: next[0] || "SPY" }));
    }
    flash();
  };

  const change = (patch) => {
    setPrefs(writeDeskPrefs(patch));
    flash();
  };

  const reset = () => {
    const next = resetPersonalization();
    setList(next.watchlist);
    setPrefs(next.prefs);
    flash();
    toast.success("Your desk is back to the defaults.");
  };

  const tabLabel = DESK_TABS.find((t) => t.id === prefs.tab)?.label || "Overview";
  const tfLabel = TIMEFRAMES.find((t) => t.id === prefs.timeframe)?.label || "1 minute";

  return (
    <section id="personalize" className="section-pad relative z-10" data-testid="personalize-section">
      <div className="shell">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-4">
            <p className="t-label">Your desk, not a template</p>
            <h2 className="t-title mt-4 text-ink">
              No account. Still <span className="acc">yours</span>.
            </h2>
            <p className="t-body mt-5 max-w-[420px]">
              Pick the tickers you actually follow and the view you want to land on. The desk opens with both already set.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                ["A watchlist that stays put", "Up to twelve symbols, in the order you choose."],
                ["An opening view, not a click-through", "Symbol, timeframe and the first tab are saved."],
                ["Local by construction", "Stored in this browser only. No account, no email, no profile on a server."],
              ].map(([head, body]) => (
                <li key={head} className="flex gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-mint/30 bg-mint/10 text-mint">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[14px] font-medium text-ink">{head}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-steel">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-8">
            <div className="panel p-5 sm:p-6" data-testid="personalize-panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-well text-mint">
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-medium text-ink">Your watchlist</h3>
                    <p className="text-[12px] text-faint">The desk reads this exact list when you open it.</p>
                  </div>
                </div>
                <span className="num text-[11.5px] text-faint" data-testid="watchlist-count">
                  {list.length} / {MAX_WATCHLIST}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2" data-testid="watchlist-chips">
                {list.length ? (
                  list.map((symbol) => (
                    <span key={symbol} className="chip">
                      <span className="num px-2.5 py-1.5 text-[13px] text-ink">{symbol}</span>
                      <button
                        type="button"
                        onClick={() => remove(symbol)}
                        className="border-l border-line px-2 py-1.5 text-steel transition-colors hover:text-bear"
                        aria-label={`Remove ${symbol} from your watchlist`}
                        data-testid={`watchlist-remove-${symbol}`}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  ))
                ) : (
                  <p className="text-[13px] text-faint">Your watchlist is empty. Add a ticker below.</p>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      add();
                    }
                  }}
                  maxLength={10}
                  placeholder="Add a ticker, e.g. AMD"
                  aria-label="Add a ticker to your watchlist"
                  className="min-w-[190px] flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-mint/60"
                  data-testid="watchlist-input"
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={add} data-testid="watchlist-add">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </button>
              </div>

              <div className="mt-6 border-t border-line pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[15px] font-medium text-ink">Opening view</h3>
                  <span className="num text-[11.5px] text-faint">{tabLabel}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-steel">Where the desk should start when you open it.</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
                  The 1-minute view needs your own Alpaca keys. Without keys, the free feed opens the nearest timeframe it can serve (5 minutes).
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-[11.5px] uppercase tracking-[0.08em] text-faint">Symbol</span>
                    <select
                      value={prefs.symbol}
                      onChange={(event) => change({ symbol: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-[13px] text-ink outline-none focus:border-mint/60"
                      data-testid="pref-symbol"
                    >
                      {(list.includes(prefs.symbol) ? list : [prefs.symbol, ...list]).map((symbol) => (
                        <option key={symbol} value={symbol}>
                          {symbol}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11.5px] uppercase tracking-[0.08em] text-faint">Timeframe</span>
                    <select
                      value={prefs.timeframe}
                      onChange={(event) => change({ timeframe: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-[13px] text-ink outline-none focus:border-mint/60"
                      data-testid="pref-timeframe"
                    >
                      {TIMEFRAMES.map((tf) => (
                        <option key={tf.id} value={tf.id}>
                          {tf.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11.5px] uppercase tracking-[0.08em] text-faint">Open on</span>
                    <select
                      value={prefs.tab}
                      onChange={(event) => change({ tab: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-[13px] text-ink outline-none focus:border-mint/60"
                      data-testid="pref-tab"
                    >
                      {DESK_TABS.map((tab) => (
                        <option key={tab.id} value={tab.id}>
                          {tab.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <a className="btn btn-solid" href={DESK_PATH} target="_blank" rel="noopener noreferrer" data-testid="personalize-open">
                  Open my desk
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <button type="button" className="btn btn-quiet btn-sm" onClick={reset} data-testid="personalize-reset">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset
                </button>
                <span className="text-[12.5px] text-faint" aria-live="polite" data-testid="personalize-status">
                  {saved ? "Saved in this browser." : `${prefs.symbol} · ${tfLabel} · ${tabLabel}`}
                </span>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                These are the same local keys the desk uses. Clearing this site&apos;s browser data removes them. Nothing is sent to a TickSPY account, because there is no account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
