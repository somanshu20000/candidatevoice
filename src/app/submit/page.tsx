"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import StageBadge from "@/components/StageBadge";
import { companies } from "@/data/mockData";
import type { RejectionStage } from "@/data/mockData";
import { AlertTriangle, CheckCircle } from "lucide-react";

const STAGES: { value: RejectionStage; label: string }[] = [
  { value: "applied",     label: "Applied — rejected before any contact"   },
  { value: "screened",    label: "Screened — rejected after recruiter call" },
  { value: "interviewed", label: "Interviewed — rejected after interviews"  },
  { value: "offered",     label: "Offer Rescinded"                          },
];

const STEP_LABELS = ["Company", "Role & Stage", "Reason", "Experience"];

interface FormState {
  company_id: string;
  role_title: string;
  rejection_stage: RejectionStage | "";
  rejection_reason: string;
  experience_text: string;
}

export default function SubmitPage() {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<FormState>({
    company_id:       "",
    role_title:       "",
    rejection_stage:  "",
    rejection_reason: "",
    experience_text:  "",
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function canAdvance(): boolean {
    if (step === 1) return form.company_id !== "";
    if (step === 2) return form.role_title.trim() !== "" && form.rejection_stage !== "";
    if (step === 3) return form.rejection_reason.trim().length >= 10;
    if (step === 4) return form.experience_text.trim().length >= 20;
    return false;
  }

  function handleSubmit() {
    // Client-side only for now (Phase 3 will wire to DB)
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <CheckCircle className="h-12 w-12 text-[#38BDF8] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">Submission received</h1>
            <p className="text-[#94A3B8] mb-6">
              Your experience has been submitted anonymously and is pending moderation review.
              It will be published once approved.
            </p>
            <a
              href="/browse"
              className="inline-flex items-center gap-2 bg-[#38BDF8] text-[#0F172A] px-5 py-2.5 text-sm font-semibold rounded hover:bg-[#7DD3FC] transition-colors"
            >
              Browse submissions →
            </a>
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
        <p className="text-sm text-[#64748B] mb-8">
          Your submission is anonymous. No personal information is stored.
        </p>

        {/* Warning banner */}
        <div className="flex items-start gap-3 border border-[#F87171]/30 bg-[#F87171]/10 rounded p-3 mb-8">
          <AlertTriangle className="h-4 w-4 text-[#F87171] mt-0.5 shrink-0" />
          <p className="text-xs text-[#F87171] leading-relaxed">
            <span className="font-semibold">Do not include</span> recruiter names, employee names,
            or proprietary information. Submissions containing these will be rejected during moderation.
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-0 mb-10">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const active    = num === step;
            const completed = num < step;
            return (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs font-mono font-semibold transition-colors
                    ${completed ? "bg-[#38BDF8] border-[#38BDF8] text-[#0F172A]" :
                      active    ? "border-[#38BDF8] text-[#38BDF8]" :
                                  "border-[#334155] text-[#475569]"}`}
                  >
                    {completed ? "✓" : num}
                  </div>
                  <span className={`text-[10px] font-mono mt-1 ${active ? "text-[#38BDF8]" : "text-[#475569]"}`}>
                    {label}
                  </span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${completed ? "bg-[#38BDF8]" : "bg-[#334155]"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="border border-[#334155] bg-[#1E293B] rounded p-6 mb-6">

          {/* Step 1: Company */}
          {step === 1 && (
            <div>
              <label className="block text-sm font-medium text-white mb-3">
                Which company rejected you?
              </label>
              <select
                value={form.company_id}
                onChange={(e) => update("company_id", e.target.value)}
                className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors"
              >
                <option value="">Select a company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.industry}</option>
                ))}
              </select>
            </div>
          )}

          {/* Step 2: Role & Stage */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Role title applied for
                </label>
                <input
                  type="text"
                  value={form.role_title}
                  onChange={(e) => update("role_title", e.target.value)}
                  placeholder="e.g. Senior Software Engineer"
                  className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-3">
                  At what stage were you rejected?
                </label>
                <div className="space-y-2">
                  {STAGES.map((s) => (
                    <label
                      key={s.value}
                      className={`flex items-center gap-3 border rounded p-3 cursor-pointer transition-colors
                        ${form.rejection_stage === s.value
                          ? "border-[#38BDF8] bg-[#38BDF8]/10"
                          : "border-[#334155] hover:border-[#475569]"}`}
                    >
                      <input
                        type="radio"
                        name="stage"
                        value={s.value}
                        checked={form.rejection_stage === s.value}
                        onChange={(e) => update("rejection_stage", e.target.value as RejectionStage)}
                        className="accent-[#38BDF8]"
                      />
                      <span className="text-sm text-[#94A3B8]">{s.label}</span>
                      <span className="ml-auto">
                        <StageBadge stage={s.value} />
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Rejection reason */}
          {step === 3 && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                What reason were you given (if any)?
              </label>
              <textarea
                value={form.rejection_reason}
                onChange={(e) => update("rejection_reason", e.target.value.slice(0, 500))}
                placeholder="e.g. Did not meet the bar on the system design round."
                rows={4}
                className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569] resize-none"
              />
              <p className="text-right text-[11px] font-mono text-[#475569] mt-1">
                {form.rejection_reason.length} / 500
              </p>
            </div>
          )}

          {/* Step 4: Full experience */}
          {step === 4 && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Describe your full experience
              </label>
              <p className="text-xs text-[#64748B] mb-3">
                Include interview format, number of rounds, timeline, and anything
                a future candidate would find useful.
              </p>
              <textarea
                value={form.experience_text}
                onChange={(e) => update("experience_text", e.target.value.slice(0, 2000))}
                placeholder="Walk through the process from application to rejection…"
                rows={8}
                className="w-full bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-2.5 focus:outline-none focus:border-[#38BDF8] transition-colors placeholder:text-[#475569] resize-none"
              />
              <p className="text-right text-[11px] font-mono text-[#475569] mt-1">
                {form.experience_text.length} / 2000
              </p>
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
              disabled={!canAdvance()}
              className="text-sm bg-[#38BDF8] text-[#0F172A] font-semibold px-5 py-2 rounded hover:bg-[#7DD3FC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Submit Anonymously →
            </button>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
