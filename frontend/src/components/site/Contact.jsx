import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Reveal, SplitWords } from "@/components/site/motion";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return "Please check your name, email and message.";
  return "Something went wrong. Please try again.";
};

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
    setBusy(true);
    try {
      await axios.post(`${API}/contact`, f);
      toast.success("Message sent.", { description: "Thanks. We will get back to you soon." });
      setF({ name: "", email: "", message: "" });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="glass flex h-full flex-col gap-5 p-6 sm:p-8" data-testid="contact-form">
      <div>
        <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">General contact</h3>
        <p className="mt-2 text-[14px] text-steel">Questions, partnerships or just saying hi.</p>
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
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append("screenshot", file);
    try {
      await axios.post(`${API}/feedback`, fd);
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
    <form onSubmit={submit} className="glass flex h-full flex-col gap-5 p-6 sm:p-8" data-testid="feedback-form">
      <div>
        <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">Feedback and bug reports</h3>
        <p className="mt-2 text-[14px] text-steel">Found something broken or want something built? Tell us.</p>
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
          <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="feedback-screenshot-preview">
            <img src={preview} alt="Screenshot preview" className="h-14 w-20 rounded-lg object-cover" />
            <span className="flex-1 truncate text-[13px] text-ink">{file?.name}</span>
            <button type="button" onClick={clear} className="rounded-full px-3 py-1 text-[13px] text-steel hover:text-bear" data-testid="feedback-screenshot-remove">Remove</button>
          </div>
        ) : (
          <label htmlFor="f-shot" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/15 px-4 py-4 text-[14px] text-steel transition-colors hover:border-mint/50 hover:text-ink" data-testid="feedback-screenshot-dropzone">
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
    <div className="mx-auto max-w-desk px-6">
      <div className="mb-12 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SplitWords text="Talk to us." accent={["us"]} className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl" />
        <Reveal delay={0.2}><p className="flex items-center gap-3 text-base text-steel md:text-lg" data-testid="contact-note"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-mint text-mint" />We actually read these.</p></Reveal>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal amount={0.15}><ContactForm /></Reveal>
        <Reveal amount={0.15} delay={0.15}><FeedbackForm /></Reveal>
      </div>
    </div>
  </section>
);
