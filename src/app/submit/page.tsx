"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import type { HiringSubmission } from "@/types/index";
import { AlertTriangle, Check } from "lucide-react";
import { normalizeCompanySlug } from "@/lib/company-slug";

type ExperienceBucket = HiringSubmission["experience_bucket"];
type Stage = HiringSubmission["stage"];
type Outcome = HiringSubmission["outcome"];
type ResponseTimeBucket = HiringSubmission["response_time_bucket"];
type LastInteractionGap = HiringSubmission["last_interaction_gap"];
type CallDuration = HiringSubmission["call_duration"];
type FirstInteractionOutcome = HiringSubmission["first_interaction_outcome"];
type PaymentFlagOption = "no" | "before_interview" | "after_interview" | "training_fee";

interface FormState {
  company: string;
  role: string;
  experience_bucket: ExperienceBucket | "";
  stage: Stage | "";
  outcome: Outcome | "";
  response_time_bucket: ResponseTimeBucket | "";
  last_interaction_gap: LastInteractionGap | "";
  call_duration: CallDuration | "";
  first_interaction_outcome: FirstInteractionOutcome | "";
  reason: string;
  payment_flag: PaymentFlagOption | "";
}

const STEP_LABELS = ["Company & Role", "Stage & Outcome", "Timeline", "Details"];

const SELECT_CLS =
  "w-full bg-paper border border-rule text-ink-soft text-sm rounded-sm px-3 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors";

const INPUT_CLS =
  "w-full bg-paper border border-rule text-ink text-sm rounded-sm px-3 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint";

const LABEL_CLS = "block text-sm font-medium text-ink mb-1.5";

const WARNING = (
  <div className="flex items-start gap-3 border border-[#E6C4BF] bg-[#F9EEEC] rounded-sm p-3.5 mb-8">
    <AlertTriangle className="h-4 w-4 text-bad mt-0.5 shrink-0" />
    <p className="text-xs text-bad leading-relaxed">
      <span className="font-semibold">Do not include names.</span>{" "}
      Submit honest, factual data only.
    </p>
  </div>
);

const EMPTY: FormState = {
  company: "", role: "", experience_bucket: "",
  stage: "", outcome: "",
  response_time_bucket: "", last_interaction_gap: "",
  call_duration: "", first_interaction_outcome: "",
  reason: "", payment_flag: "",
};

export default function SubmitPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Company slug of a completed submission; switches the page to the confirmation view. */
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  useEffect(() => {
    const companyFromQuery = new URLSearchParams(window.location.search).get("company");
    if (!companyFromQuery) return;
    const normalized = decodeURIComponent(companyFromQuery).replace(/-/g, " ").trim();
    if (!normalized) return;
    setForm((prev) => (prev.company ? prev : { ...prev, company: normalized }));
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step === 1) return form.company.trim() !== "" && form.role.trim() !== "" && form.experience_bucket !== "";
    if (step === 2) return form.stage !== "" && form.outcome !== "";
    if (step === 3) return form.response_time_bucket !== "" && form.last_interaction_gap !== "" && form.call_duration !== "" && form.first_interaction_outcome !== "";
    if (step === 4) return form.reason !== "" && form.payment_flag !== "";
    return false;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const normalizedCompany = normalizeCompanySlug(form.company);
    if (!normalizedCompany) {
      setSubmitting(false);
      setError("Company is required.");
      return;
    }

    const payload: Omit<HiringSubmission, "id" | "created_at"> = {
      company: normalizedCompany,
      role: form.role.trim(),
      experience_bucket: form.experience_bucket as ExperienceBucket,
      stage: form.stage as Stage,
      outcome: form.outcome as Outcome,
      response_time_bucket: form.response_time_bucket as ResponseTimeBucket,
      last_interaction_gap: form.last_interaction_gap as LastInteractionGap,
      call_duration: form.call_duration as CallDuration,
      first_interaction_outcome: form.first_interaction_outcome as FirstInteractionOutcome,
      reason: form.reason,
      payment_flag: form.payment_flag !== "no",
      is_approved: false,
    };

    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Something went wrong. Please try again.");
    } else {
      // Show a confirmation rather than redirecting straight to the company
      // page. The previous behaviour pushed to /company/[slug]?unlocked=true —
      // a query param nothing ever read — where a submission awaiting
      // moderation is (correctly) invisible. If it was the company's only
      // report the user landed back on "be the first to submit", with no
      // acknowledgement that anything had happened.
      setSubmittedTo(normalizedCompany);
    }
  }

  // --- Confirmation ---------------------------------------------------------
  if (submittedTo) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-20 w-full flex-1">
          <div className="border border-rule bg-paper-sheet rounded-sm p-10 shadow-sheet text-center">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full border border-good/40 bg-[#E8F0EA] mb-6">
              <Check className="h-6 w-6 text-good" />
            </div>

            <h1 className="font-serif text-3xl text-ink mb-3">Submission received</h1>
            <p className="text-sm text-ink-soft leading-relaxed mb-8 max-w-md mx-auto">
              Your report about{" "}
              <span className="text-ink capitalize font-medium">
                {submittedTo.replace(/-/g, " ")}
              </span>{" "}
              is queued for review. A human reads every submission before it is
              published, so it will not appear on the site straight away.
            </p>

            <div className="text-left border-t border-rule pt-6 mb-8 space-y-3">
              <p className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                What happens next
              </p>
              <ul className="text-sm text-ink-soft space-y-2">
                <li>— A moderator checks it for names and identifying details.</li>
                <li>— If it passes, it joins that company&apos;s public data.</li>
                <li>
                  — Because reports are anonymous, we have no way to contact you
                  about the outcome, and no way to link this report back to you.
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-2.5 justify-center">
              <Link
                href={`/company/${encodeURIComponent(submittedTo)}`}
                className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
              >
                View {submittedTo.replace(/-/g, " ")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setStep(1);
                  setError(null);
                  setSubmittedTo(null);
                }}
                className="inline-flex items-center gap-2 border border-rule-strong bg-paper-sheet text-ink-soft px-5 py-2.5 text-sm font-medium rounded-sm hover:border-ink-faint hover:text-ink transition-colors"
              >
                Share another experience
              </button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-14 w-full flex-1">
        <h1 className="font-serif text-3xl text-ink mb-2">Share Your Experience</h1>
        <p className="text-sm text-ink-muted mb-10">Anonymous. No personal data stored.</p>

        {/* Progress bar */}
        <div className="flex items-center gap-0 mb-10">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const active = num === step;
            const done = num < step;
            return (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs font-mono font-medium transition-colors
                    ${done ? "bg-accent border-accent text-paper-sheet" :
                      active ? "border-accent text-accent bg-paper-sheet" :
                               "border-rule-strong text-ink-faint bg-paper-sheet"}`}>
                    {done ? "✓" : num}
                  </div>
                  <span className={`text-[10px] font-mono mt-1.5 text-center ${active ? "text-accent" : "text-ink-faint"}`}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${done ? "bg-accent" : "bg-rule-strong"}`} />
                )}
              </div>
            );
          })}
        </div>

        {WARNING}

        <div className="border border-rule bg-paper-sheet rounded-sm p-7 mb-6 shadow-sheet">

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="company" className={LABEL_CLS}>Company name</label>
                <input
                  id="company"
                  type="text"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="e.g. Razorpay"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="role" className={LABEL_CLS}>Role applied for</label>
                <input
                  id="role"
                  type="text"
                  value={form.role}
                  onChange={(e) => set("role", e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="experience" className={LABEL_CLS}>Years of experience</label>
                <select id="experience" value={form.experience_bucket} onChange={(e) => set("experience_bucket", e.target.value as ExperienceBucket)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="0-1">0–1 years</option>
                  <option value="1-3">1–3 years</option>
                  <option value="3-5">3–5 years</option>
                  <option value="5-8">5–8 years</option>
                  <option value="8+">8+ years</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="stage" className={LABEL_CLS}>Stage reached</label>
                <select id="stage" value={form.stage} onChange={(e) => set("stage", e.target.value as Stage)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="applied">Applied</option>
                  <option value="screening">Screening</option>
                  <option value="technical">Technical</option>
                  <option value="hr">HR</option>
                  <option value="final">Final</option>
                </select>
              </div>
              <div>
                <label htmlFor="outcome" className={LABEL_CLS}>Outcome</label>
                <select id="outcome" value={form.outcome} onChange={(e) => set("outcome", e.target.value as Outcome)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="rejected">Rejected</option>
                  <option value="no_response">No Response</option>
                  <option value="offer">Offer</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="response-time" className={LABEL_CLS}>Response time</label>
                <select id="response-time" value={form.response_time_bucket} onChange={(e) => set("response_time_bucket", e.target.value as ResponseTimeBucket)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="0-3">0–3 days</option>
                  <option value="4-7">4–7 days</option>
                  <option value="8-14">8–14 days</option>
                  <option value="15+">15+ days</option>
                </select>
              </div>
              <div>
                <label htmlFor="last-gap" className={LABEL_CLS}>Last interaction gap</label>
                <select id="last-gap" value={form.last_interaction_gap} onChange={(e) => set("last_interaction_gap", e.target.value as LastInteractionGap)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="0-7">0–7 days</option>
                  <option value="8-14">8–14 days</option>
                  <option value="15-30">15–30 days</option>
                  <option value="30+">30+ days</option>
                </select>
              </div>
              <div>
                <label htmlFor="call-duration" className={LABEL_CLS}>Call duration</label>
                <select id="call-duration" value={form.call_duration} onChange={(e) => set("call_duration", e.target.value as CallDuration)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="<2">&lt;2 min</option>
                  <option value="2-5">2–5 min</option>
                  <option value="5-15">5–15 min</option>
                  <option value="15+">15+ min</option>
                  <option value="na">N/A</option>
                </select>
              </div>
              <div>
                <label htmlFor="first-outcome" className={LABEL_CLS}>First interaction outcome</label>
                <select id="first-outcome" value={form.first_interaction_outcome} onChange={(e) => set("first_interaction_outcome", e.target.value as FirstInteractionOutcome)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="continued">Continued</option>
                  <option value="rejected_immediately">Rejected immediately</option>
                  <option value="na">N/A</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="reason" className={LABEL_CLS}>Reason given</label>
                <select id="reason" value={form.reason} onChange={(e) => set("reason", e.target.value)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="experience_mismatch">Experience mismatch</option>
                  <option value="skill_mismatch">Skill mismatch</option>
                  <option value="culture_fit">Culture fit</option>
                  <option value="no_reason">No reason given</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="payment" className={LABEL_CLS}>Payment requested?</label>
                <select id="payment" value={form.payment_flag} onChange={(e) => set("payment_flag", e.target.value as PaymentFlagOption)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="no">No</option>
                  <option value="before_interview">Before interview</option>
                  <option value="after_interview">After interview</option>
                  <option value="training_fee">Training fee</option>
                </select>
              </div>
              {error && (
                <p className="text-sm text-bad border border-[#E6C4BF] bg-[#F9EEEC] rounded-sm px-3 py-2.5">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="text-sm border border-rule-strong bg-paper-sheet text-ink-soft px-5 py-2.5 rounded-sm hover:border-ink-faint hover:text-ink transition-colors"
            >
              ← Back
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="text-sm bg-accent text-paper-sheet font-medium px-6 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canAdvance() || submitting}
              className="text-sm bg-accent text-paper-sheet font-medium px-6 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting…" : "Submit Anonymously →"}
            </button>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
