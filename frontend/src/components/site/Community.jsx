import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { listComments, postComment, deleteComment, identityIsPersistent } from "@/lib/comments";

// The community wall. Its copy is deliberately static: the comments themselves
// are fetched in the browser, so the section still reads as a real section in
// the prerendered HTML that crawlers and ad reviewers see.
//
// Everything below is rendered as text. There is no dangerouslySetInnerHTML in
// this file, on purpose: a comment is a string, and React escaping it is the
// whole defence against one visitor writing markup into another visitor's page.
// Links are therefore not clickable — a small cost for not making the wall an
// injection surface.

const AVATAR = [
  "bg-[#243449] text-[#9fb9de]",
  "bg-[#2a3b33] text-[#9ed3b4]",
  "bg-[#3a2f24] text-[#e0bd93]",
  "bg-[#33283d] text-[#c9aee0]",
  "bg-[#3b2a2a] text-[#e0a9a9]",
  "bg-[#2d3238] text-[#bcc6d2]",
];

function ago(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

function initials(nickname) {
  const words = String(nickname || "").split(/\s+/).filter(Boolean);
  // A one-word name has no second initial, and `("")[0]` is undefined — which
  // used to render as "QUNDEFINED" instead of "Q".
  const first = (words[0] || "?")[0] || "?";
  const second = (words[1] || "")[0] || "";
  return (first + second).toUpperCase();
}

function messageFor(error) {
  // A 404 on delete means the row is already gone — moderated away, or deleted
  // in another tab. That is a real answer, so it is checked before the
  // "404 means an older Worker" fallback below, which used to tell the visitor
  // the whole wall was switched off.
  if (error?.code === "not_found") return "That comment no longer exists.";
  // 404 is what an older Worker (without the comments routes) answers, and 503
  // is what this one answers when its D1 binding is missing. Both mean the same
  // thing to a visitor, and neither should surface a raw status code.
  if (error?.code === "not_configured" || error?.status === 404 || error?.status === 503) {
    return "The community wall is not switched on for this deployment yet.";
  }
  if (error?.code === "network" || error?.code === "timeout" || error?.code === "comments_failed") {
    return "The community wall could not be reached. Check your connection and try again.";
  }
  return error?.message || "Something went wrong.";
}

const DeleteControl = ({ comment, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="link-quiet text-[12.5px] underline underline-offset-2"
        data-testid={`comment-delete-${comment.id}`}
      >
        Delete
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-faint">
      Delete this comment?
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onDelete(comment);
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
        className="font-medium text-ink underline underline-offset-2"
        data-testid={`comment-delete-confirm-${comment.id}`}
      >
        {busy ? "Deleting..." : "Yes, delete it"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="link-quiet underline underline-offset-2">
        Cancel
      </button>
    </span>
  );
};

export const Community = () => {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [items, setItems] = useState([]);
  const [you, setYou] = useState(null);
  const [total, setTotal] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [siteKey, setSiteKey] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const captchaEl = useRef(null);
  const widget = useRef(null);

  const load = async (signal) => {
    setStatus("loading");
    setError("");
    try {
      const data = await listComments({ signal });
      if (signal?.aborted) return;
      setItems(data.comments || []);
      setYou(data.you || null);
      setSiteKey(data.turnstile?.siteKey || "");
      setTotal(typeof data.total === "number" ? data.total : null);
      setNextBefore(data.nextBefore || null);
      setStatus("ready");
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") return;
      setError(messageFor(err));
      setStatus("error");
    }
  };

  useEffect(() => {
    // The build-time snapshot must not wait on (or leak) a live API call. A
    // deterministic "loading" list is what belongs in the static HTML.
    if (typeof window !== "undefined" && window.__TICKSPY_PRERENDER__) return undefined;
    setPersistent(identityIsPersistent());
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  /* Turnstile is rendered only when the Worker advertises a site key, so a
   * deployment without the gate renders nothing and posts exactly as before.
   * The script is loaded from here rather than from index.html, which keeps it
   * out of the prerendered HTML and off every other page. */
  const mountCaptcha = useCallback(() => {
    if (!siteKey || !captchaEl.current || !window.turnstile || widget.current !== null) return;
    widget.current = window.turnstile.render(captchaEl.current, {
      sitekey: siteKey,
      theme: "dark",
      callback: (value) => setCaptchaToken(value),
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => setCaptchaToken(""),
    });
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey) return undefined;
    if (window.turnstile) {
      mountCaptcha();
      return undefined;
    }
    let script = document.getElementById("cf-turnstile-script");
    if (!script) {
      script = document.createElement("script");
      script.id = "cf-turnstile-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", mountCaptcha);
    return () => script.removeEventListener("load", mountCaptcha);
  }, [siteKey, mountCaptcha]);

  useEffect(
    () => () => {
      if (widget.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch (_) {
          /* the widget was already torn down with the page */
        }
      }
      widget.current = null;
    },
    []
  );

  const resetCaptcha = () => {
    setCaptchaToken("");
    if (siteKey && widget.current !== null && window.turnstile) {
      try {
        window.turnstile.reset(widget.current);
      } catch (_) {
        /* a stale widget is harmless: the server has the final say */
      }
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (posting || text.length < 3) return;
    if (siteKey && !captchaToken) {
      setNotice({ kind: "error", text: "Finish the quick human check, then post." });
      return;
    }
    setPosting(true);
    setNotice(null);
    try {
      const result = await postComment(text, captchaToken || undefined);
      setDraft("");
      setItems((previous) => [{ ...result.comment, held: result.held }, ...previous]);
      if (!result.held) setTotal((n) => (typeof n === "number" ? n + 1 : n));
      setStatus("ready");
      setNotice({
        kind: result.held ? "held" : "ok",
        text: result.held
          ? result.message
          : "Posted. It is signed with your generated name, and only this browser can delete it.",
      });
    } catch (err) {
      setNotice({ kind: "error", text: messageFor(err) });
    } finally {
      setPosting(false);
      // A Turnstile token works once, so the widget has to ask again.
      resetCaptcha();
    }
  };

  const remove = async (comment) => {
    try {
      await deleteComment(comment.id);
      setItems((previous) => previous.filter((c) => c.id !== comment.id));
      if (!comment.held) setTotal((n) => (typeof n === "number" ? Math.max(0, n - 1) : n));
      toast.success("Comment deleted.", { description: "The text is gone from the server as well." });
    } catch (err) {
      toast.error(messageFor(err));
    }
  };

  const more = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await listComments({ before: nextBefore });
      setItems((previous) => [...previous, ...(data.comments || [])]);
      setNextBefore(data.nextBefore || null);
    } catch (err) {
      toast.error(messageFor(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const remaining = 1000 - draft.length;

  return (
    <section id="community" className="section-pad relative z-10" data-testid="community-section">
      <div className="shell">
        <div className="mb-10 grid gap-5 lg:grid-cols-12 lg:items-end">
          <h2 className="t-title text-ink lg:col-span-7">
            Compare notes with <span className="acc">people using the same desk</span>.
          </h2>
          <p className="max-w-[540px] text-[14px] leading-relaxed text-steel lg:col-span-5 lg:justify-self-end">
            What worked, what broke, what the numbers did not explain. No account and no email — every comment is signed with a
            name this browser generated for you, and you can delete your own at any time.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* The composer comes first in the source so a phone reaches it without
              scrolling past a conversation it has not joined yet. */}
          <form onSubmit={submit} className="panel h-fit p-5 sm:p-6 lg:col-span-4" data-testid="community-form">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="t-label">Post anonymously</p>
              <span
                className="rounded-full border border-line bg-surface2 px-3 py-1 text-[12px] text-steel"
                data-testid="community-nickname"
              >
                {you?.nickname || "Anonymous"}
              </span>
            </div>

            <label htmlFor="community-body" className="sr-only">
              Your comment
            </label>
            <textarea
              id="community-body"
              className="field mt-4 resize-y"
              rows={5}
              maxLength={1000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="What did you try, what did the desk get right, and what did it miss? Specific beats clever."
              data-testid="community-input"
            />

            <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-faint">
              <span>Plain text. Links are not clickable.</span>
              <span className={remaining < 100 ? "text-ink" : ""}>{draft.length}/1000</span>
            </div>

            {siteKey && (
              <div className="mt-4 flex justify-center" ref={captchaEl} data-testid="community-turnstile" />
            )}

            <button
              type="submit"
              className="btn btn-solid mt-3 w-full"
              disabled={posting || draft.trim().length < 3}
              data-testid="community-submit"
            >
              {posting ? "Posting..." : "Post comment"}
            </button>

            {notice && (
              <p
                role="status"
                className={`mt-4 rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed ${
                  notice.kind === "error"
                    ? "border-[#7a3b3b] bg-[#2a1c1c] text-[#e5b4b4]"
                    : notice.kind === "held"
                      ? "border-[#6b5a2a] bg-[#2a2418] text-[#e0c98d]"
                      : "border-[#2c4c3d] bg-[#16261f] text-[#a9d8bf]"
                }`}
                data-testid="community-notice"
              >
                {notice.text}
              </p>
            )}

            <div className="mt-5 space-y-2 text-[12px] leading-relaxed text-faint">
              <p>
                Your name comes from a random key stored in this browser. The server keeps only a one-way hash of it, never your
                address, and it cannot link a comment back to you.
              </p>
              {!persistent && (
                <p className="text-[#e0c98d]">
                  This browser blocks local storage, so your name lasts only for this tab and your comment cannot be deleted after
                  you close it.
                </p>
              )}
              <p>Do not post personal information, account keys or anything you would not say in public. No advice, no promotion.</p>
            </div>
          </form>

          <div className="lg:col-span-8" data-testid="community-list">
            <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
              <h3 className="text-[15px] font-medium text-ink">Recent comments</h3>
              <p className="text-[12.5px] text-faint" data-testid="community-count">
                {typeof total === "number" ? `${total} ${total === 1 ? "comment" : "comments"}` : "Anonymous"}
              </p>
            </div>

            {status === "loading" && (
              <div className="space-y-5 py-6" aria-busy="true" data-testid="community-loading">
                <p className="text-[13.5px] text-faint">Loading comments...</p>
              </div>
            )}

            {status === "error" && (
              <div className="panel mt-6 p-5" data-testid="community-error">
                <p className="text-[13.5px] leading-relaxed text-steel">{error}</p>
                <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => load()}>
                  Try again
                </button>
              </div>
            )}

            {status === "ready" && items.length === 0 && (
              <p className="py-10 text-[13.5px] leading-relaxed text-faint" data-testid="community-empty">
                No comments yet. If you have used the desk, the first note is yours.
              </p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-line">
                {items.map((comment) => (
                  <li key={comment.id} className="py-5" data-testid={`comment-${comment.id}`}>
                    <div className="flex items-start gap-3">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-medium ${
                          AVATAR[comment.avatar] || AVATAR[0]
                        }`}
                        aria-hidden="true"
                      >
                        {initials(comment.nickname)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <p className="text-[13.5px] font-medium text-ink">{comment.nickname}</p>
                          <time dateTime={comment.createdAt} className="text-[11.5px] text-faint">
                            {ago(comment.createdAt)}
                          </time>
                          {comment.mine && (
                            <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-mint">
                              you
                            </span>
                          )}
                          {comment.held && (
                            <span className="rounded-full border border-[#6b5a2a] px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-[#e0c98d]">
                              held for review
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-steel">
                          {comment.body}
                        </p>
                        {comment.mine && (
                          <div className="mt-2">
                            <DeleteControl comment={comment} onDelete={remove} />
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {nextBefore && (
              <button
                type="button"
                onClick={more}
                disabled={loadingMore}
                className="btn btn-ghost btn-sm mt-5"
                data-testid="community-more"
              >
                {loadingMore ? "Loading..." : "Load older comments"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
