import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Unplug,
  X,
} from "lucide-react";
import { DESK_PATH } from "@/lib/site";
import { DEFAULT_WATCHLIST, WATCHLIST_EVENT, readWatchlist } from "@/lib/personalization";
import {
  alertConfig,
  buildSiteRules,
  defaultRules,
  forgetSubscription,
  linkStatus,
  readRules,
  rememberRules,
  rememberSubscription,
  sendTest,
  startLink,
  storedSubscription,
  unsubscribe,
} from "@/lib/alerts";

const DESK_ALERTS = `${DESK_PATH}#alert`;

function explain(error) {
  if (error?.code === "timeout") return "The alerts service took too long to answer. Try again in a moment.";
  if (error?.code === "network") return "The alerts service could not be reached. Check your connection and try again.";
  return error?.message || "Something went wrong.";
}

function whenLabel(iso) {
  if (!iso) return "no alert sent yet";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "an alert was sent";
  return `last alert ${date.toLocaleString()}`;
}

/*
 * The interactive form that turns the section above from a tutorial into an
 * actual setup. It reuses the Worker's public link endpoints; no secret and no
 * chat id ever reaches this page.
 */
export const TelegramConnect = () => {
  const [phase, setPhase] = useState("loading"); // loading | off | ready | linking | connected | error
  const [config, setConfig] = useState(null);
  const [sub, setSub] = useState(null);
  const [link, setLink] = useState(null);
  const [pendingRules, setPendingRules] = useState(null);
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [symbol, setSymbol] = useState("SPY");
  const [direction, setDirection] = useState("above");
  const [price, setPrice] = useState("");
  const [headlines, setHeadlines] = useState(true);
  const [calendar, setCalendar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const cfg = await alertConfig();
      const saved = storedSubscription();
      setConfig(cfg);
      setSub(saved);
      setPhase(cfg.telegram ? (saved ? "connected" : "ready") : "off");
    } catch (e) {
      setConfig(null);
      setSub(storedSubscription());
      setPhase("error");
      setError(explain(e));
    }
  }, []);

  useEffect(() => {
    setWatchlist(readWatchlist());
    const sync = () => setWatchlist(readWatchlist());
    window.addEventListener(WATCHLIST_EVENT, sync);
    return () => window.removeEventListener(WATCHLIST_EVENT, sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || window.__TICKSPY_PRERENDER__) return;
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!link) return undefined;
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      try {
        const result = await linkStatus(link.code);
        if (cancelled) return;
        if (result.linked && result.id && result.token) {
          const saved = rememberSubscription({
            id: result.id,
            token: result.token,
            chat: result.subscription?.chat || "Telegram chat",
            lastSentAt: result.subscription?.lastSentAt || null,
          });
          // A linked response this page cannot store would otherwise leave the
          // status badge saying "connected" while no panel renders, because the
          // connected block needs a usable subscription in state.
          if (!saved) {
            setLink(null);
            setPendingRules(null);
            setPhase(config?.telegram ? "ready" : "off");
            setError("Telegram reported a connection, but this browser could not store it. Press Connect Telegram to link again.");
            return;
          }
          const rules = result.subscription?.rules || pendingRules;
          if (rules) rememberRules(rules);
          setSub(saved);
          setLink(null);
          setPendingRules(null);
          setPhase("connected");
          setError("");
          toast.success("Telegram is connected. This chat will receive your alerts.");
          return;
        }
        if (result.expired) {
          setLink(null);
          setPendingRules(null);
          setPhase(config?.telegram ? "ready" : "off");
          setError("That link code expired. Press Connect Telegram for a fresh one.");
          return;
        }
      } catch (e) {
        if (!cancelled) setError(explain(e));
      }
      if (!cancelled) timer = setTimeout(tick, 3000);
    };

    timer = setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, pendingRules, config]);

  const begin = async () => {
    if (!config?.telegram) return;
    const rawPrice = price.trim();
    const value = rawPrice ? Number(rawPrice) : null;
    if (rawPrice && (!Number.isFinite(value) || value <= 0)) {
      toast.error("Enter a positive alert price, or leave the price box empty.");
      return;
    }
    if (rawPrice && !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      toast.error("Enter a valid US ticker for the price alert.");
      return;
    }
    const hasHeadlines = headlines && watchlist.length > 0;
    if (!rawPrice && !hasHeadlines && !calendar) {
      toast.error("Choose at least one alert: a price, headlines, or the calendar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rules = buildSiteRules({
        base: readRules(),
        watchlist,
        price: rawPrice ? { sym: symbol, type: direction, val: value } : null,
        headlines: hasHeadlines,
        calendar,
      });
      const result = await startLink(rules);
      if (!result || typeof result.code !== "string" || typeof result.deepLink !== "string") {
        throw new Error("The alerts service did not return a usable link code.");
      }
      setPendingRules(rules);
      setLink(result);
      setPhase("linking");
      try {
        window.open(result.deepLink, "_blank", "noopener,noreferrer");
      } catch (_) {
        // A blocked popup is fine: the same link is shown on screen.
      }
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setLink(null);
    setPendingRules(null);
    setError("");
    setPhase(config?.telegram ? "ready" : "off");
  };

  const test = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await sendTest(sub.id, sub.token);
      const next = rememberSubscription({ ...sub, lastSentAt: new Date().toISOString() });
      if (next) setSub(next);
      toast.success("Test message sent. It should arrive in Telegram within a few seconds.");
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        forgetSubscription();
        setSub(null);
        setPhase(config?.telegram ? "ready" : "off");
        setError(e.message || "That chat is no longer connected. Link it again.");
      } else {
        toast.error(explain(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await unsubscribe(sub.id, sub.token);
      forgetSubscription();
      rememberRules(defaultRules());
      setSub(null);
      setPhase(config?.telegram ? "ready" : "off");
      toast.success("Telegram alerts are off, and the server record was deleted.");
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        forgetSubscription();
        rememberRules(defaultRules());
        setSub(null);
        setPhase(config?.telegram ? "ready" : "off");
        toast.success("That connection was already gone on the server, so it was cleared here too.");
      } else {
        toast.error(`Could not delete the server record: ${explain(e)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const bot = config?.botUsername ? `@${config.botUsername}` : "@tickspy_alerts_bot";
  const tick = config?.tickMinutes || 5;

  return (
    <div className="panel p-5 sm:p-6" data-testid="telegram-setup">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-well text-mint">
            <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-[16px] font-medium text-ink">Set it up here</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-steel">
              Choose one rule, press once, and finish by pressing START in Telegram. No form on this page stores your chat id.
            </p>
          </div>
        </div>
        <span className="num text-[11px] text-faint" data-testid="telegram-status">
          {phase === "connected" ? "connected" : phase === "off" ? "not enabled" : phase === "error" ? "unavailable" : phase === "loading" ? "checking" : "ready"}
        </span>
      </div>

      {phase === "loading" ? (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-steel" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-mint" aria-hidden="true" />
          Checking the alerts service...
        </div>
      ) : null}

      {phase === "off" ? (
        <div className="mt-4 rounded-xl border border-amber/30 bg-amber/[0.07] p-4">
          <p className="text-[13.5px] font-medium text-amber">Telegram alerts are not switched on for this deployment yet.</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-steel">
            {config?.note || "The edge API has no bot token, so nothing can be sent from it."} The desk still works; only the Telegram delivery is off.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} data-testid="telegram-refresh">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Check again
            </button>
            <a className="btn btn-ghost btn-sm" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer">
              Open the desk alerts tab
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="mt-4 rounded-xl border border-bear/30 bg-bear/[0.06] p-4">
          <p className="text-[13.5px] font-medium text-bear">The alerts service could not be reached.</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-steel">{error}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} data-testid="telegram-refresh">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </button>
            <a className="btn btn-ghost btn-sm" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer">
              Open the desk
            </a>
          </div>
        </div>
      ) : null}

      {phase === "ready" ? (
        <div className="mt-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-amber/30 bg-amber/[0.07] px-3 py-2 text-[12.5px] text-amber">{error}</p>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-[11.5px] uppercase tracking-[0.09em] text-faint">Price alert</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block">
                  <span className="sr-only">Symbol</span>
                  <input
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                    list="telegram-watchlist"
                    maxLength={12}
                    className="field num text-[13px]"
                    placeholder="SPY"
                    data-testid="telegram-symbol"
                  />
                  <datalist id="telegram-watchlist">
                    {watchlist.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="sr-only">Condition</span>
                  <select
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                    className="field text-[13px]"
                    data-testid="telegram-direction"
                  >
                    <option value="above">rises above</option>
                    <option value="below">falls below</option>
                  </select>
                </label>
              </div>
              <label className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
                <span className="num text-[12px] text-steel">$</span>
                <input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="price (optional)"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
                  aria-label="Alert price, optional"
                  data-testid="telegram-price"
                />
              </label>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">Leave the price empty to skip this rule.</p>
            </div>

            <div>
              <p className="text-[11.5px] uppercase tracking-[0.09em] text-faint">Also send me</p>
              <div className="mt-2 space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={headlines && watchlist.length > 0}
                    onChange={(event) => setHeadlines(event.target.checked)}
                    disabled={!watchlist.length}
                    className="mt-0.5"
                    data-testid="telegram-headlines"
                  />
                  <span>
                    <span className="block text-[12.5px] text-ink">Headlines about my watchlist</span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">
                      {watchlist.length ? watchlist.slice(0, 10).join(", ") : "Add a ticker in Personalize first."}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={calendar}
                    onChange={(event) => setCalendar(event.target.checked)}
                    className="mt-0.5"
                    data-testid="telegram-calendar"
                  />
                  <span>
                    <span className="block text-[12.5px] text-ink">US economic releases</span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-faint">High and medium impact, 15 minutes before.</span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button type="button" className="btn btn-solid" onClick={begin} disabled={busy} data-testid="telegram-connect">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Connect Telegram
            </button>
            <span className="text-[12px] text-faint">Checked every {tick} minutes · clock runs on our server</span>
            <a className="ml-auto text-[12.5px] text-mint hover:underline" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer">
              Full rule editor in the desk
              <ArrowRight className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null}

      {phase === "linking" && link ? (
        <div className="mt-4 rounded-xl border border-mint/30 bg-mint/[0.06] p-4" data-testid="telegram-pending">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
              <Send className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Waiting for Telegram</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-steel">
                Open {bot} and press <b>START</b>. The link already carries the one-time code; this page finishes by itself.
              </p>
              <p className="num mt-2 text-[11.5px] text-faint">code {link.code}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn btn-ghost btn-sm" href={link.deepLink} target="_blank" rel="noopener noreferrer">
                  Open {bot} in Telegram
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <button type="button" className="btn btn-quiet btn-sm" onClick={cancel} data-testid="telegram-cancel">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Cancel
                </button>
              </div>
              {error ? <p className="mt-2 text-[11.5px] text-amber">{error}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {phase === "connected" && sub ? (
        <div className="mt-4 rounded-xl border border-mint/30 bg-mint/[0.06] p-4" data-testid="telegram-connected">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mint/15 text-mint">
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Connected to {sub.chat}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-steel">
                The server checks this chat every {tick} minutes. {whenLabel(sub.lastSentAt)}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={test} disabled={busy} data-testid="telegram-test">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                  Send a test message
                </button>
                <a className="btn btn-ghost btn-sm" href={DESK_ALERTS} target="_blank" rel="noopener noreferrer">
                  Edit rules in the desk
                </a>
                <button type="button" className="btn btn-quiet btn-sm" onClick={disconnect} disabled={busy} data-testid="telegram-disconnect">
                  <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                  Disconnect and delete
                </button>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
                Rules are stored on the edge server only while this chat is connected. Pressing Disconnect deletes the record, not just the button.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
