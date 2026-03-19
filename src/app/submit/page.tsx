"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { supabase } from "@/lib/supabase/browser";
import type { HiringSubmission } from "@/types/index";
import { AlertTriangle, CheckCircle } from "lucide-react";

type ExperienceBucket = HiringSubmission["experience_bucket"];
type Stage = HiringSubmission["stage"];
type Outcome = HiringSubmission["outcome"];
type ResponseTimeBucket = HiringSubmission["response_time_bucket"];
type LastInteractionGap = HiringSubmission["last_interaction_gap"];
type CallDuration = NonNullable<HiringSubmission["call_duration"]>;
type FirstInteractionOutcome = NonNullable<HiringSubmission["first_interaction_outcome"]>;
type Reason = NonNullable<HiringSubmission["reason"]>;
type PaymentFlag = NonNullable<HiringSubmission["payment_flag"]>;

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
  reason: Reason | "";
  payment_flag: PaymentFlag | "";
}

const STEP_LABELS = ["Company & Role", "Stage & Outcome", "Timeline", "Details"];

const SELECT_CLS =
  "w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors";

const WARNING = (
  <div className="flex items-start gap-3 border border-[#F87171]/30 bg-[#F87171]/10 rounded p-3 mb-6">
    <AlertTriangle className="h-4 w-4 text-[#F87171] mt-0.5 shrink-0" />
    <p className="text-xs text-[#F87171] leading-relaxed">
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
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const payload: HiringSubmission = {
      company: form.company.trim(),
      role: form.role.trim(),
      experience_bucket: form.experience_bucket as ExperienceBucket,
      stage: form.stage as Stage,
      outcome: form.outcome as Outcome,
      response_time_bucket: form.response_time_bucket as ResponseTimeBucket,
      last_interaction_gap: form.last_interaction_gap as LastInteractionGap,
      call_duration: form.call_duration as CallDuration,
      first_interaction_outcome: form.first_interaction_outcome as FirstInteractionOutcome,
      reason: form.reason as Reason,
      payment_flag: form.payment_flag as PaymentFlag,
    };

    const { error: sbError } = await supabase
      .from("hiring_submissions")
      .insert([payload]);

    setSubmitting(false);
    if (sbError) {
      setError("Something went wrong. Please try again.");
    } else {
      setSubmitted(true);
      setForm(EMPTY);
      setStep(1);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <CheckCircle className="h-12 w-12 text-[#38BDF8] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Submitted anonymously. Thank you.</h1>
            <p className="text-[#94A3B8] mb-6 text-sm">
              Your data helps future candidates understand the hiring process. It may take
              a moment to appear in search results.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setSubmitted(false)}
                className="text-sm border border-[#334155] text-[#94A3B8] px-4 py-2 rounded hover:border-[#38BDF8] transition-colors"
              >
                Submit another
              </button>
              <a
                href="/browse"
                className="text-sm bg-[#38BDF8] text-[#0F172A] font-semibold px-4 py-2 rounded hover:bg-[#7DD3FC] transition-colors"
              >
                Browse data →
              </a>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-12 w-full flex-1">
        <h1 className="text-2xl font-bold text-white mb-2">Share Your Experience</h1>
        <p className="text-sm text-[#64748B] mb-8">Anonymous. No personal data stored.</p>

        {/* Progress bar */}
        <div className="flex items-center gap-0 mb-10">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const active = num === step;
            const done = num < step;
            return (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs font-mono font-semibold transition-colors
                    ${done ? "bg-[#38BDF8] border-[#38BDF8] text-[#0F172A]" :
                      active ? "border-[#38BDF8] text-[#38BDF8]" :
                               "border-[#334155] text-[#475569]"}`}>
                    {done ? "✓" : num}
                  </div>
                  <span className={`text-[10px] font-mono mt-1 text-center ${active ? "text-[#38BDF8]" : "text-[#475569]"}`}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${done ? "bg-[#38BDF8]" : "bg-[#334155]"}`} />
                )}
              </div>
            );
          })}
        </div>

        {WARNING}

        <div className="border border-[#334155] bg-[#1E293B] rounded p-6 mb-6">

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Company name</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="e.g. Razorpay"
                  className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Role applied for</label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => set("role", e.target.value)}
                  placeholder="e.g. Senior Backend Engineer"
                  className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Years of experience</label>
                <select value={form.experience_bucket} onChange={(e) => set("experience_bucket", e.target.value as ExperienceBucket)} className={SELECT_CLS}>
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
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Stage reached</label>
                <select value={form.stage} onChange={(e) => set("stage", e.target.value as Stage)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="applied">Applied</option>
                  <option value="screening">Screening</option>
                  <option value="technical">Technical</option>
                  <option value="hr">HR</option>
                  <option value="final">Final</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Outcome</label>
                <select value={form.outcome} onChange={(e) => set("outcome", e.target.value as Outcome)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="rejected">Rejected</option>
                  <option value="no_response">No Response</option>
                  <option value="offer">Offer</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Response time</label>
                <select value={form.response_time_bucket} onChange={(e) => set("response_time_bucket", e.target.value as ResponseTimeBucket)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="0-3">0–3 days</option>
                  <option value="4-7">4–7 days</option>
                  <option value="8-14">8–14 days</option>
                  <option value="15+">15+ days</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Last interaction gap</label>
                <select value={form.last_interaction_gap} onChange={(e) => set("last_interaction_gap", e.target.value as LastInteractionGap)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="0-7">0–7 days</option>
                  <option value="8-14">8–14 days</option>
                  <option value="15-30">15–30 days</option>
                  <option value="30+">30+ days</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Call duration</label>
                <select value={form.call_duration} onChange={(e) => set("call_duration", e.target.value as CallDuration)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="<2">&lt;2 min</option>
                  <option value="2-5">2–5 min</option>
                  <option value="5-15">5–15 min</option>
                  <option value="15+">15+ min</option>
                  <option value="na">N/A</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">First interaction outcome</label>
                <select value={form.first_interaction_outcome} onChange={(e) => set("first_interaction_outcome", e.target.value as FirstInteractionOutcome)} className={SELECT_CLS}>
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
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Reason given</label>
                <select value={form.reason} onChange={(e) => set("reason", e.target.value as Reason)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="experience_mismatch">Experience mismatch</option>
                  <option value="skill_mismatch">Skill mismatch</option>
                  <option value="culture_fit">Culture fit</option>
                  <option value="no_reason">No reason given</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Payment requested?</label>
                <select value={form.payment_flag} onChange={(e) => set("payment_flag", e.target.value as PaymentFlag)} className={SELECT_CLS}>
                  <option value="">Select…</option>
                  <option value="no">No</option>
                  <option value="before_interview">Before interview</option>
                  <option value="after_interview">After interview</option>
                  <option value="training_fee">Training fee</option>
                </select>
              </div>
              {error && (
                <p className="text-sm text-[#F87171] border border-[#F87171]/30 bg-[#F87171]/10 rounded px-3 py-2">
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
              className="text-sm border border-[#334155] text-[#94A3B8] px-4 py-2 rounded hover:border-[#475569] transition-colors"
            >
              ← Back
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="text-sm bg-[#38BDF8] text-[#0F172A] font-semibold px-5 py-2 rounded hover:bg-[#7DD3FC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canAdvance() || submitting}
              className="text-sm bg-[#38BDF8] text-[#0F172A] font-semibold px-5 py-2 rounded hover:bg-[#7DD3FC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
