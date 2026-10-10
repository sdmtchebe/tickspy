import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Reveal } from "@/components/site/motion";

// The contact/feedback forms post straight to a support inbox through FormSubmit
// (formsubmit.co), a serverless relay that answers CORS and forwards the message
// as an email. Nothing has to be running for this to work, so the forms behave
// identically on GitHub Pages and on a local machine.
//
// To enable them, set the destination address once, either:
//   - build time: REACT_APP_SUPPORT_EMAIL in the environment, or
//   - runtime:    window.DESK_SUPPORT_EMAIL in a small script in index.html.
// Until an address is set the forms say so plainly instead of failing vaguely.
const SUPPORT_EMAIL =
  (typeof window !== "undefined" && window.DESK_SUPPORT_EMAIL) ||
  process.env.REACT_APP_SUPPORT_EMAIL ||
  "";
const ENDPOINT = SUPPORT_EMAIL ? `https://formsubmit.co/ajax/${SUPPORT_EMAIL}` : "";
const API_MISSING = "Messaging is not configured on this deployment.";

// Returns a human-readable reason when FormSubmit rejects the POST.
const errMsg = (e) => {
  const m = String(e?.message || e || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "Could not reach the mail service. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
};

// Send one message. `body` is either a plain object (sent as JSON) or FormData
// (used by the feedback form so an optional screenshot rides along).
async function send(body) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json", Accept: "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`send failed (${res.status})`);
  const j = await res.json().catch(() => ({}));
  if (String(j.success) === "false") throw new Error(j.message || "send failed");
  return j;
}

const Field = ({ id, label, children }) => (
  <label htmlFor={id} className="block">
    <span className="label">{label}</span>
    {children}
  </label>
);

const Submit = ({ busy, testId, children }) => (
  <button type="submit" className="btn btn-solid w-full sm:w-auto" disabled={busy} data-testid={testId}>
    {busy ? "Sending..." : children}
  </button>
);

const ContactForm = () => {
  const [f, setF] = useState({ name: "", email: "", message: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!ENDPOINT) { toast.error(API_MISSING); return; }
    setBusy(true);
    try {
      await send({
        name: f.name,
        email: f.email,
        message: f.message,
        _subject: `TickSPY contact from ${f.name || "a visitor"}`,
        _template: "table",
      });
      toast.success("Message sent.", { description: "Thanks. We will get back to you soon." });
      setF({ name: "", email: "", message: "" });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="panel flex h-full flex-col gap-5 p-6 sm:p-7" data-testid="contact-form">
      <div>
        <h3 className="text-[17px] font-medium text-ink">General contact</h3>
        <p className="mt-1.5 text-[13.5px] text-steel">Questions, partnerships, or a note about something you liked.</p>
      </div>
      <Field id="c-name" label="Name"><input id="c-name" required maxLength={120} className="field" value={f.name} onChange={set("name")} placeholder="Your name" data-testid="contact-name-input" /></Field>
      <Field id="c-email" label="Email"><input id="c-email" type="email" required className="field" value={f.email} onChange={set("email")} placeholder="you@example.com" data-testid="contact-email-input" /></Field>
      <Field id="c-msg" label="Message"><textarea id="c-msg" required maxLength={5000} rows={6} className="field resize-none" value={f.message} onChange={set("message")} placeholder="What is on your mind?" data-testid="contact-message-input" /></Field>
      <div className="mt-auto pt-2"><Submit busy={busy} testId="contact-form-submit">Send message</Submit></div>
    </form>
  );
};

const CATS = ["Feedback", "Bug Report", "Feature Request"];

const FeedbackForm = () => {
  const empty = { name: "", email: "", category: "Feedback", message: "" };
  const [f, setF] = useState(empty);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (e) => {
    const x = e.target.files?.[0];
    if (!x) return;
    if (!x.type.startsWith("image/")) { toast.error("Screenshot must be an image."); return; }
    if (x.size > 5 * 1024 * 1024) { toast.error("Screenshot must be under 5 MB."); return; }
    setFile(x);
  };
  const clear = () => { setFile(null); if (input.current) input.current.value = ""; };

  const submit = async (e) => {
    e.preventDefault();
    if (!ENDPOINT) { toast.error(API_MISSING); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("Category", f.category);
    fd.append("Name", f.name);
    fd.append("Email", f.email);
    fd.append("Message", f.message);
    fd.append("_subject", `TickSPY ${f.category} from ${f.name || "a visitor"}`);
    fd.append("_template", "table");
    if (file) fd.append("attachment", file);
    try {
      await send(fd);
      toast.success(`${f.category} received.`, { description: "Thanks for helping make TickSPY better." });
      setF(empty);
      clear();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel flex h-full flex-col gap-5 p-6 sm:p-7" data-testid="feedback-form">
      <div>
        <h3 className="text-[17px] font-medium text-ink">Feedback and bug reports</h3>
        <p className="mt-1.5 text-[13.5px] text-steel">Found something broken, or want something built? Tell us.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="f-name" label="Name"><input id="f-name" required maxLength={120} className="field" value={f.name} onChange={set("name")} placeholder="Your name" data-testid="feedback-name-input" /></Field>
        <Field id="f-email" label="Email"><input id="f-email" type="email" required className="field" value={f.email} onChange={set("email")} placeholder="you@example.com" data-testid="feedback-email-input" /></Field>
      </div>
      <Field id="f-cat" label="Category">
        <div className="relative">
          <select id="f-cat" className="field" value={f.category} onChange={set("category")} data-testid="feedback-category-select">
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 text-steel" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </div>
      </Field>
      <Field id="f-msg" label="Message"><textarea id="f-msg" required maxLength={5000} rows={4} className="field resize-none" value={f.message} onChange={set("message")} placeholder="What happened, or what would help?" data-testid="feedback-message-input" /></Field>
      <div>
        <span className="label">Screenshot (optional)</span>
        <input ref={input} id="f-shot" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={pick} data-testid="feedback-screenshot-input" />
        {preview ? (
          <div className="well flex items-center gap-4 p-3" data-testid="feedback-screenshot-preview">
            <img src={preview} alt="Screenshot preview" className="h-14 w-20 rounded-[6px] object-cover" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{file?.name}</span>
            <button type="button" onClick={clear} className="btn btn-quiet btn-sm" data-testid="feedback-screenshot-remove">Remove</button>
          </div>
        ) : (
          <label htmlFor="f-shot" className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-white/20 px-4 py-4 text-[14px] text-steel transition-colors duration-150 hover:border-mint/50 hover:text-ink" data-testid="feedback-screenshot-dropzone">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M8 11V3M5 6l3-3 3 3M2 11v2h12v-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Attach an image, up to 5 MB
          </label>
        )}
      </div>
      <div className="mt-auto pt-2"><Submit busy={busy} testId="feedback-form-submit">Send {f.category.toLowerCase()}</Submit></div>
    </form>
  );
};

export const Contact = () => (
  <section id="contact" className="section-pad relative z-10" data-testid="contact-section">
    <div className="shell">
      <div className="mb-11 grid gap-5 lg:grid-cols-12 lg:items-end">
        <h2 className="t-title text-ink lg:col-span-7">Tell us what broke, or what to build next.</h2>
        <Reveal delay={0.15} className="lg:col-span-5 lg:justify-self-end">
          <p className="flex items-center gap-3 text-[14px] text-steel" data-testid="contact-note">
            <span className="live-dot" aria-hidden="true" />
            Every message reaches a real inbox.
          </p>
        </Reveal>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Reveal amount={0.15}><ContactForm /></Reveal>
        <Reveal amount={0.15} delay={0.08}><FeedbackForm /></Reveal>
      </div>
    </div>
  </section>
);
