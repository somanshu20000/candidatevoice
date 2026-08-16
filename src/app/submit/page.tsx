"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import type { HiringSubmission, ApplicationChannel } from "@/types/index";
import { AlertTriangle, Check } from "lucide-react";
import { normalizeCompanySlug } from "@/lib/company-slug";
import type {
  SalaryHistoryStage,
  SalaryProofType,
  SalaryProofStage,
  SalaryRangeDisclosed,
  ReporterType,
  ExitExperienceLetter,
  ExitSettlement,
  ExitDocumentation,
  WouldRecommend,
  TenureBucket,
  ConductEnvironment,
} from "@/types/index";
import type { PerceivedSeriousness, IntentReason } from "@/lib/hiring-intent/events";
import { INTENT_REASON_VALUES } from "@/lib/hiring-intent/events";

/** Human labels for the closed intent-reason enum (migration 0023). */
const INTENT_REASON_LABELS: Record<IntentReason, string> = {
  recruiter_responsiveness: "Recruiter responsiveness",
  interview_scheduling: "Interview scheduling",
  hiring_manager_involvement: "Hiring manager involvement",
  role_clarity: "Clarity of the role",
  salary_discussion: "Salary discussion",
  repeated_delays: "Repeated delays",
  vague_process: "Vague hiring process",
  role_disappeared: "Role disappeared",
  hiring_freeze_signals: "Signs of a hiring freeze",
};
import {
  DIMENSIONS,
  EMOTIONS,
  facetsForDimension,
  type FacetKey,
  type EmotionKey,
} from "@/lib/fingerprint/taxonomy";

type ExperienceBucket = HiringSubmission["experience_bucket"];
// NonNullable: these five became nullable at the DB/type level (migration
// 0021) so a non-candidate report can omit them. The FORM never stores null
// though — an unset field is "" until submit time, where it becomes null only
// for a non-candidate relationship. See handleSubmit.
type Stage = NonNullable<HiringSubmission["stage"]>;
type Outcome = NonNullable<HiringSubmission["outcome"]>;
type ResponseTimeBucket = NonNullable<HiringSubmission["response_time_bucket"]>;
type LastInteractionGap = NonNullable<HiringSubmission["last_interaction_gap"]>;
type CallDuration = NonNullable<HiringSubmission["call_duration"]>;
type FirstInteractionOutcome = NonNullable<HiringSubmission["first_interaction_outcome"]>;
type PaymentFlagOption = "no" | "before_interview" | "after_interview" | "training_fee";

/** The likert dimensions a candidate can rate, in display order. Derived from the
 *  taxonomy — a facet added by a later migration (e.g. 0017's clarity facets)
 *  appears here automatically, with no edit to this file. */
const LIKERT_DIMENSIONS = DIMENSIONS.filter(
  (d) => d.measurement === "likert" && d.sourceType !== "employee"
);
/** The one emotion-measured dimension (Emotional Climate). */
const EMOTION_DIMENSION = DIMENSIONS.find((d) => d.measurement === "emotion") ?? null;

interface FormState {
  /** Which of the three relationships this report is (migration 0020).
   *  Drives which later steps appear — see stepsFor(). Defaults to 'candidate'
   *  so the wizard behaves exactly as before unless the reporter changes it. */
  relationship: ReporterType;
  /** The raw text the user typed — preserved as evidence regardless of which
   *  organization (if any) they went on to confirm. Never used to resolve
   *  identity; see company_organization_id. */
  company: string;
  /** Set ONLY by an explicit "This is the company" click (migration 0022).
   *  null means unconfirmed — canAdvance() blocks past step 1 without it
   *  (or company_not_listed). The server re-verifies this id independently;
   *  it is never trusted as-is. */
  company_organization_id: string | null;
  /** Display name of the confirmed organization, for the locked summary UI. */
  company_confirmed_name: string | null;
  /** Explicit "Company isn't listed" choice — an alternative way to satisfy
   *  the confirmation requirement without an organization_id. */
  company_not_listed: boolean;
  /** Optional, only used alongside company_not_listed — feeds company_requests. */
  company_request_domain: string;
  role: string;
  experience_bucket: ExperienceBucket | "";
  /** Optional — unlike every other field, skipping this must not block submission.
   *  It only powers cohort filtering on the company page; adding friction here
   *  fights the platform's actual bottleneck (evidence acquisition). */
  application_channel: ApplicationChannel | "";
  stage: Stage | "";
  outcome: Outcome | "";
  response_time_bucket: ResponseTimeBucket | "";
  last_interaction_gap: LastInteractionGap | "";
  call_duration: CallDuration | "";
  first_interaction_outcome: FirstInteractionOutcome | "";
  reason: string;
  payment_flag: PaymentFlagOption | "";
  /** Compensation privacy (0018). All optional; "" means unanswered → null. */
  salary_history_stage: SalaryHistoryStage | "";
  salary_proof_type: SalaryProofType | "";
  salary_proof_stage: SalaryProofStage | "";
  salary_range_disclosed: SalaryRangeDisclosed | "";
  /** Hiring-intent perception (migration 0023). Candidate-only, optional, and
   *  explicitly a PERCEPTION — never rendered as objective fact. "" → no event. */
  perceived_seriousness: PerceivedSeriousness | "";
  intent_reasons: IntentReason[];
  /** Tenure-stage practices (migration 0020). All optional; "" → null. */
  exit_experience_letter: ExitExperienceLetter | "";
  exit_settlement: ExitSettlement | "";
  exit_documentation: ExitDocumentation | "";
  would_recommend: WouldRecommend | "";
  tenure_bucket: TenureBucket | "";
  conduct_environment: ConductEnvironment | "";
  /** Optional Likert facet ratings (1–5), keyed by facet_key. Absent = not rated.
   *  Everything here is optional: evidence acquisition is the bottleneck, so a
   *  contributor who fills nothing still submits a valid Family A report. */
  ratings: Partial<Record<FacetKey, number>>;
  /** Optional emotion tags. */
  emotions: EmotionKey[];
}

type StepKey = "basics" | "process" | "timeline" | "details" | "exit" | "culture" | "experience";

/**
 * Which steps appear, and in what order, depends entirely on `relationship` —
 * the interview-specific steps (process/timeline/details, including the 0018
 * salary questions, which are candidate-knowable by definition) only make
 * sense for someone who actually interviewed. exit/culture are the tenure-stage
 * counterparts (0020). `experience` (facet ratings + emotions) appears for
 * everyone, but a candidate additionally sees the interview-specific facets —
 * see the render logic for LIKERT_DIMENSIONS below.
 */
function stepsFor(relationship: ReporterType): { key: StepKey; label: string }[] {
  if (relationship === "employee") {
    return [
      { key: "basics", label: "Company & Role" },
      { key: "culture", label: "Culture & Conduct" },
      { key: "experience", label: "Experience" },
    ];
  }
  if (relationship === "former_employee") {
    return [
      { key: "basics", label: "Company & Role" },
      { key: "exit", label: "Exit" },
      { key: "culture", label: "Culture & Conduct" },
      { key: "experience", label: "Experience" },
    ];
  }
  return [
    { key: "basics", label: "Company & Role" },
    { key: "process", label: "Stage & Outcome" },
    { key: "timeline", label: "Timeline" },
    { key: "details", label: "Details" },
    { key: "experience", label: "Experience" },
  ];
}

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

// V2.3 — an honest, plain-language statement of how a report stays anonymous.
// Every claim here maps to an enforced invariant: no PII collected (D-007), a
// closed-enum structured form rather than free text about a person, dates
// coarsened to the month at the public boundary (public_submissions, migration
// 0003), and small-company reports shown only in aggregate above a minimum
// count (the effective-N floors, D-002) — never as one identifiable report.
// A native <details> so it is unobtrusive (collapsed by default) and needs no
// JavaScript. It collects nothing new.
const PRIVACY_NOTE = (
  <details className="mb-6 border border-rule rounded-sm bg-paper-sheet">
    <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-ink-soft hover:text-ink">
      How your report stays anonymous
    </summary>
    <div className="px-4 pb-4 pt-1 text-sm text-ink-muted leading-relaxed space-y-2">
      <p>
        We never ask for or store your name, email, or any contact detail. There
        is no account and nothing that ties a report back to you.
      </p>
      <p>
        The form is structured — you pick from set answers, you don&apos;t write
        about a person. Reports describe what a company did, not who did it.
      </p>
      <p>
        Dates are coarsened to the month before anything is shown publicly, so a
        report can&apos;t be pinned to the moment you submitted it.
      </p>
      <p>
        At a small company, a single report is never shown on its own. A
        company&apos;s numbers appear only once enough people have reported the
        same thing — below that threshold we show nothing, so no individual
        report is identifiable.
      </p>
    </div>
  </details>
);

const EMPTY: FormState = {
  relationship: "candidate",
  company: "", company_organization_id: null, company_confirmed_name: null,
  company_not_listed: false, company_request_domain: "",
  role: "", experience_bucket: "", application_channel: "",
  stage: "", outcome: "",
  response_time_bucket: "", last_interaction_gap: "",
  call_duration: "", first_interaction_outcome: "",
  reason: "", payment_flag: "",
  salary_history_stage: "", salary_proof_type: "", salary_proof_stage: "", salary_range_disclosed: "",
  perceived_seriousness: "", intent_reasons: [],
  exit_experience_letter: "", exit_settlement: "", exit_documentation: "",
  would_recommend: "", tenure_bucket: "", conduct_environment: "",
  ratings: {}, emotions: [],
};

interface RankedCandidate {
  organizationId: string;
  displayName: string;
  slug: string;
  score: number;
  matchReason: string;
  website: string | null;
  logoUrl: string;
}

/**
 * Company discovery + explicit confirmation (migration 0022). NEVER writes
 * organization_id itself — it only searches and lets the user confirm, and
 * the parent's canAdvance() blocks progress until either a confirmation or
 * an explicit "isn't listed" choice exists. /api/submit re-verifies whatever
 * id this eventually produces; nothing here is trusted as final.
 */
function CompanyPicker({
  query,
  organizationId,
  confirmedName,
  notListed,
  requestDomain,
  onQueryChange,
  onConfirm,
  onChangeSelection,
  onToggleNotListed,
  onRequestDomainChange,
}: {
  query: string;
  organizationId: string | null;
  confirmedName: string | null;
  notListed: boolean;
  requestDomain: string;
  onQueryChange: (v: string) => void;
  onConfirm: (organizationId: string, displayName: string) => void;
  onChangeSelection: () => void;
  onToggleNotListed: (v: boolean) => void;
  onRequestDomainChange: (v: string) => void;
}) {
  const [candidates, setCandidates] = useState<RankedCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (organizationId || notListed) return; // already resolved — no need to search
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      setHasSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/company-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("search failed");
        const body = (await res.json()) as { candidates?: RankedCandidate[] };
        if (!cancelled) setCandidates(body.candidates ?? []);
      } catch {
        if (!cancelled) setSearchFailed(true);
      } finally {
        if (!cancelled) {
          setSearching(false);
          setHasSearched(true);
        }
      }
    }, 300); // debounce — search-as-you-type without hammering the route
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, organizationId, notListed]);

  // --- Locked / confirmed state ---------------------------------------------
  if (organizationId && confirmedName) {
    return (
      <div>
        <label className={LABEL_CLS}>Company</label>
        <div className="flex items-center justify-between gap-3 border border-good/40 bg-[#E8F0EA] rounded-sm px-3.5 py-2.5">
          <span className="text-sm text-ink flex items-center gap-2">
            <Check className="h-4 w-4 text-good shrink-0" />
            {confirmedName}
          </span>
          <button type="button" onClick={onChangeSelection} className="text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-hover shrink-0">
            Change
          </button>
        </div>
      </div>
    );
  }

  // --- "Company isn't listed" state -----------------------------------------
  if (notListed) {
    return (
      <div>
        <label className={LABEL_CLS}>Company</label>
        <div className="border border-rule bg-paper rounded-sm p-3.5 space-y-3">
          <p className="text-xs text-ink-soft">
            <span className="font-medium text-ink">{query || "This company"}</span> will be recorded as
            reported and queued for a moderator to add — your report is not blocked on that review.
          </p>
          <div>
            <label htmlFor="company-request-domain" className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-1">
              Company website <span className="text-ink-faint normal-case">(optional, helps us find it)</span>
            </label>
            <input
              id="company-request-domain"
              type="text"
              value={requestDomain}
              onChange={(e) => onRequestDomainChange(e.target.value)}
              placeholder="e.g. example.com"
              className={INPUT_CLS}
            />
          </div>
          <button type="button" onClick={() => onToggleNotListed(false)} className="text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-hover">
            ← Search again
          </button>
        </div>
      </div>
    );
  }

  // --- Search state -----------------------------------------------------------
  return (
    <div>
      <label htmlFor="company" className={LABEL_CLS}>Company name</label>
      <input
        id="company"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="e.g. Razorpay"
        className={INPUT_CLS}
        autoComplete="off"
      />
      {query.trim().length >= 2 && (
        <div className="mt-2.5 border border-rule bg-paper-sheet rounded-sm divide-y divide-rule">
          {searching ? (
            <p className="text-xs text-ink-faint px-3.5 py-3">Searching…</p>
          ) : searchFailed ? (
            <p className="text-xs text-bad px-3.5 py-3">Search is temporarily unavailable — you can still continue below.</p>
          ) : candidates.length > 0 ? (
            candidates.map((c) => (
              <div key={c.organizationId} className="flex items-center gap-3 px-3.5 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- logo route serves arbitrary storage-backed images, not a static import */}
                <img src={c.logoUrl} alt="" className="h-8 w-8 rounded-sm border border-rule object-contain shrink-0 bg-paper" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{c.displayName}</p>
                  {c.website && <p className="text-[11px] text-ink-faint truncate">{c.website.replace(/^https?:\/\//, "")}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onConfirm(c.organizationId, c.displayName)}
                  className="text-xs font-medium bg-accent text-paper-sheet px-3 py-1.5 rounded-sm hover:bg-accent-hover transition-colors shrink-0 whitespace-nowrap"
                >
                  This is the company
                </button>
              </div>
            ))
          ) : hasSearched ? (
            <div className="px-3.5 py-3">
              <p className="text-xs text-ink-muted mb-2">No confident match for &ldquo;{query}&rdquo;.</p>
              <button type="button" onClick={() => onToggleNotListed(true)} className="text-xs font-mono uppercase tracking-wider text-accent hover:text-accent-hover">
                Company isn&apos;t listed →
              </button>
            </div>
          ) : null}
        </div>
      )}
      <p className="text-xs text-ink-faint mt-1.5">
        Search by name, common abbreviation, or paste the company&apos;s website. You&apos;ll confirm the
        exact company before this report is attached to it.
      </p>
    </div>
  );
}

/** One facet as a compact 1–5 scale, anchored by its low/high labels. Clicking
 *  the currently-selected value clears it (rating stays optional). */
function FacetRating({
  label,
  anchorLow,
  anchorHigh,
  value,
  onChange,
}: {
  label: string;
  anchorLow: string;
  anchorHigh: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="py-2.5 border-b border-rule last:border-0">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm text-ink-soft">{label}</span>
        <div className="flex gap-1 shrink-0">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${label}: ${n} of 5`}
              aria-pressed={value === n}
              onClick={() => onChange(value === n ? undefined : n)}
              className={`h-7 w-7 rounded-sm border text-xs font-mono tnum transition-colors ${
                value === n
                  ? "bg-accent border-accent text-paper-sheet"
                  : "border-rule-strong text-ink-faint bg-paper hover:border-ink-faint"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-ink-faint">
        <span>{anchorLow}</span>
        <span>{anchorHigh}</span>
      </div>
    </div>
  );
}

export default function SubmitPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Company slug of a completed submission; switches the page to the confirmation view. */
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  // The step list is a function of relationship (see stepsFor) — recomputed on
  // every render rather than stored, so it can never drift from `form.relationship`.
  const steps = stepsFor(form.relationship);
  const stepKey = steps[step - 1]?.key ?? steps[0].key;

  /** Switching relationship changes the step LIST, so any step index beyond the
   *  new list's length would point at nothing — reset to the first step
   *  (Company & Role, which every relationship shares) rather than clamp, since
   *  clamping could otherwise land mid-way through an unrelated section. */
  function setRelationship(next: ReporterType) {
    setForm((f) => ({ ...f, relationship: next }));
    setStep(1);
  }

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

  function setRating(facet: FacetKey, value: number | undefined) {
    setForm((f) => {
      const ratings = { ...f.ratings };
      if (value === undefined) delete ratings[facet];
      else ratings[facet] = value;
      return { ...f, ratings };
    });
  }

  function toggleEmotion(key: EmotionKey) {
    setForm((f) => ({
      ...f,
      emotions: f.emotions.includes(key)
        ? f.emotions.filter((e) => e !== key)
        : [...f.emotions, key],
    }));
  }

  function canAdvance(): boolean {
    if (stepKey === "basics")
      return (
        (form.company_organization_id !== null || form.company_not_listed) &&
        form.role.trim() !== "" &&
        form.experience_bucket !== ""
      );
    if (stepKey === "process") return form.stage !== "" && form.outcome !== "";
    if (stepKey === "timeline") return form.response_time_bucket !== "" && form.last_interaction_gap !== "" && form.call_duration !== "" && form.first_interaction_outcome !== "";
    if (stepKey === "details") return form.reason !== "" && form.payment_flag !== "";
    // exit/culture/experience are entirely optional — evidence acquisition is
    // the bottleneck (the same reasoning application_channel and the 0018
    // salary questions already established), and every field here is
    // first-party-only data nobody but this reporter can supply at all.
    return true;
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
    // Defense in depth — canAdvance() already blocks reaching this step
    // without either a confirmed organization or an explicit "isn't listed"
    // choice; this repeats the check at the point of the actual write.
    if (!form.company_organization_id && !form.company_not_listed) {
      setSubmitting(false);
      setError("Please confirm the company before submitting.");
      return;
    }

    const isCandidate = form.relationship === "candidate";

    const payload: Omit<HiringSubmission, "id" | "created_at"> = {
      company: normalizedCompany,
      role: form.role.trim(),
      experience_bucket: form.experience_bucket as ExperienceBucket,
      reporter_type: form.relationship,
      // The interview-specific fields below (through payment_flag) only apply
      // to a candidate report — null for employee/former_employee, exactly as
      // the route independently enforces server-side (defense in depth: even
      // if this client-side branch had a bug, the route would still null them).
      application_channel: isCandidate && form.application_channel !== "" ? form.application_channel : null,
      stage: isCandidate ? (form.stage as Stage) : null,
      outcome: isCandidate ? (form.outcome as Outcome) : null,
      response_time_bucket: isCandidate ? (form.response_time_bucket as ResponseTimeBucket) : null,
      last_interaction_gap: isCandidate ? (form.last_interaction_gap as LastInteractionGap) : null,
      call_duration: isCandidate ? (form.call_duration as CallDuration) : null,
      first_interaction_outcome: isCandidate ? (form.first_interaction_outcome as FirstInteractionOutcome) : null,
      reason: isCandidate ? form.reason : null,
      payment_flag: isCandidate && form.payment_flag !== "no",
      // "" means unanswered — send null so the column stays null, never "no".
      // Compensation privacy (0018) is candidate-knowable only, per its own header.
      salary_history_stage: isCandidate ? form.salary_history_stage || null : null,
      salary_proof_type: isCandidate ? form.salary_proof_type || null : null,
      salary_proof_stage: isCandidate ? form.salary_proof_stage || null : null,
      salary_range_disclosed: isCandidate ? form.salary_range_disclosed || null : null,
      // Tenure-stage practices (0020) — collectable from whichever relationship
      // actually answered; "" (unanswered) stays null either way.
      exit_experience_letter: form.exit_experience_letter || null,
      exit_settlement: form.exit_settlement || null,
      exit_documentation: form.exit_documentation || null,
      would_recommend: form.would_recommend || null,
      tenure_bucket: form.tenure_bucket || null,
      conduct_environment: form.conduct_environment || null,
      is_approved: false,
    };

    // Family B, optional: only send facets that were actually rated. The route
    // (validateRatings/validateEmotions) treats an absent/empty array as "no
    // ratings", so omitting them entirely is a valid submission.
    const ratings = Object.entries(form.ratings)
      .filter(([, v]) => typeof v === "number")
      .map(([facet_key, rating]) => ({ facet_key, rating }));
    const emotions = form.emotions.map((emotion_key) => ({ emotion_key }));

    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        ratings,
        emotions,
        // The confirmed organization_id (migration 0022) — the route
        // re-verifies this independently; it is never trusted as-is. When
        // the user chose "isn't listed" instead, organization_id is omitted
        // and the route creates a company_requests row from company_not_listed
        // + company_request_domain, exactly as if no match had been found.
        organization_id: form.company_organization_id,
        company_not_listed: form.company_not_listed,
        company_request_domain: form.company_not_listed ? form.company_request_domain || null : null,
        // Hiring-intent (0023) — candidate-only perception; the route ignores
        // these for non-candidate reporters and when no org was confirmed.
        perceived_seriousness: isCandidate ? form.perceived_seriousness || null : null,
        intent_reasons: isCandidate ? form.intent_reasons : [],
      }),
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
        <p className="text-sm text-ink-muted mb-4">Anonymous. No personal data stored.</p>
        {PRIVACY_NOTE}

        {/* Relationship selector — decides which steps follow (stepsFor). Lives
            outside the numbered wizard since changing it resets the step list. */}
        <div className="mb-8" role="radiogroup" aria-label="Your relationship to this company">
          <span className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-2">
            Your experience is as someone who…
          </span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "candidate", label: "Interviewed here" },
                { value: "employee", label: "Currently works here" },
                { value: "former_employee", label: "Used to work here" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={form.relationship === opt.value}
                onClick={() => setRelationship(opt.value)}
                className={`px-3.5 py-2 text-sm rounded-sm border transition-colors ${
                  form.relationship === opt.value
                    ? "bg-accent border-accent text-paper-sheet"
                    : "border-rule-strong text-ink-soft bg-paper-sheet hover:border-ink-faint"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-0 mb-10">
          {steps.map((s, i) => {
            const num = i + 1;
            const active = num === step;
            const done = num < step;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`h-7 w-7 rounded-full border flex items-center justify-center text-xs font-mono font-medium transition-colors
                    ${done ? "bg-accent border-accent text-paper-sheet" :
                      active ? "border-accent text-accent bg-paper-sheet" :
                               "border-rule-strong text-ink-faint bg-paper-sheet"}`}>
                    {done ? "✓" : num}
                  </div>
                  <span className={`text-[10px] font-mono mt-1.5 text-center ${active ? "text-accent" : "text-ink-faint"}`}>
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${done ? "bg-accent" : "bg-rule-strong"}`} />
                )}
              </div>
            );
          })}
        </div>

        {WARNING}

        <div className="border border-rule bg-paper-sheet rounded-sm p-7 mb-6 shadow-sheet">

          {/* Step 1 */}
          {stepKey === "basics" && (
            <div className="space-y-5">
              <CompanyPicker
                query={form.company}
                organizationId={form.company_organization_id}
                confirmedName={form.company_confirmed_name}
                notListed={form.company_not_listed}
                requestDomain={form.company_request_domain}
                onQueryChange={(v) => set("company", v)}
                onConfirm={(organizationId, displayName) =>
                  setForm((f) => ({ ...f, company_organization_id: organizationId, company_confirmed_name: displayName, company_not_listed: false }))
                }
                onChangeSelection={() => setForm((f) => ({ ...f, company_organization_id: null, company_confirmed_name: null }))}
                onToggleNotListed={(v) => setForm((f) => ({ ...f, company_not_listed: v, company_organization_id: null, company_confirmed_name: null }))}
                onRequestDomainChange={(v) => set("company_request_domain", v)}
              />
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
              <div>
                <label htmlFor="application-channel" className={LABEL_CLS}>
                  How did you apply? <span className="text-ink-faint font-normal">(optional)</span>
                </label>
                <select
                  id="application-channel"
                  value={form.application_channel}
                  onChange={(e) => set("application_channel", e.target.value as ApplicationChannel | "")}
                  className={SELECT_CLS}
                >
                  <option value="">Prefer not to say</option>
                  <option value="referral">Referral</option>
                  <option value="recruiter_outreach">Recruiter reached out to me</option>
                  <option value="job_board">Job board</option>
                  <option value="company_website">Company website</option>
                  <option value="other">Other</option>
                </select>
                <p className="text-xs text-ink-faint mt-1.5">
                  Lets other candidates filter results to people who applied the same way.
                </p>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {stepKey === "process" && (
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
          {stepKey === "timeline" && (
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
          {stepKey === "details" && (
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

              {/* Compensation transparency & privacy (migration 0018). All optional
                  — "Prefer not to say" leaves the column null, which every metric
                  treats as ineligible rather than as a "no". */}
              <div className="border-t border-rule pt-5 space-y-5">
                <p className="text-xs text-ink-muted">
                  Salary practices <span className="text-ink-faint">— optional, but this is the data candidates most often say they wish they&apos;d had.</span>
                </p>
                <div>
                  <label htmlFor="salary-history" className={LABEL_CLS}>Were you asked for your current/previous salary?</label>
                  <select id="salary-history" value={form.salary_history_stage} onChange={(e) => set("salary_history_stage", e.target.value as FormState["salary_history_stage"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="never">Never asked</option>
                    <option value="application">In the application form</option>
                    <option value="screening">At screening</option>
                    <option value="interview">During interviews</option>
                    <option value="offer">At offer stage</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="salary-proof" className={LABEL_CLS}>Were you asked for proof of salary?</label>
                  <select id="salary-proof" value={form.salary_proof_type} onChange={(e) => set("salary_proof_type", e.target.value as FormState["salary_proof_type"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="none">No documents requested</option>
                    <option value="payslip">Payslip</option>
                    <option value="bank_statement">Bank statement</option>
                    <option value="tax_document">Tax document (e.g. Form 16)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="salary-proof-stage" className={LABEL_CLS}>When was that proof requested?</label>
                  <select id="salary-proof-stage" value={form.salary_proof_stage} onChange={(e) => set("salary_proof_stage", e.target.value as FormState["salary_proof_stage"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="none">Never requested</option>
                    <option value="screening">At screening</option>
                    <option value="interview">During interviews</option>
                    <option value="before_offer">Before a written offer</option>
                    <option value="after_offer">After a written offer</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="salary-range" className={LABEL_CLS}>Did they share the salary range?</label>
                  <select id="salary-range" value={form.salary_range_disclosed} onChange={(e) => set("salary_range_disclosed", e.target.value as FormState["salary_range_disclosed"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="in_posting">Yes — in the job posting</option>
                    <option value="before_first">Before the first interview</option>
                    <option value="before_final">Before the final round</option>
                    <option value="at_offer">Only at offer</option>
                    <option value="never">Never shared</option>
                  </select>
                </div>
              </div>

              {/* Hiring-intent perception (migration 0023). Explicitly YOUR
                  impression, not a fact about the company. Structured reasons
                  only — no free text — so this can never become an accusation. */}
              <div className="border-t border-rule pt-5 space-y-4">
                <div>
                  <label htmlFor="seriousness" className={LABEL_CLS}>
                    How serious did the company seem about hiring you? <span className="text-ink-faint font-normal">(your impression)</span>
                  </label>
                  <select id="seriousness" value={form.perceived_seriousness} onChange={(e) => set("perceived_seriousness", e.target.value as FormState["perceived_seriousness"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="very_serious">Very serious</option>
                    <option value="serious">Serious</option>
                    <option value="neutral">Neutral / hard to tell</option>
                    <option value="not_serious">Not very serious</option>
                    <option value="very_not_serious">Not serious at all</option>
                  </select>
                  <p className="text-xs text-ink-faint mt-1.5">
                    This is recorded as your perception, shown alongside other candidates&apos; — never as a claim about what the company intended.
                  </p>
                </div>
                {form.perceived_seriousness !== "" && (
                  <div>
                    <span className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-2">
                      What shaped that impression? <span className="text-ink-faint normal-case">(optional, pick any)</span>
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {INTENT_REASON_VALUES.map((reason) => {
                        const on = form.intent_reasons.includes(reason);
                        return (
                          <button
                            key={reason}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                intent_reasons: on ? f.intent_reasons.filter((r) => r !== reason) : [...f.intent_reasons, reason],
                              }))
                            }
                            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                              on ? "bg-accent border-accent text-paper-sheet" : "border-rule-strong text-ink-soft bg-paper hover:border-ink-faint"
                            }`}
                          >
                            {INTENT_REASON_LABELS[reason]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Exit step (former_employee only) — offboarding.ts (migration 0020).
              All optional; "Prefer not to say" leaves the column null, which
              every metric treats as ineligible rather than as a "no". */}
          {stepKey === "exit" && (
            <div className="space-y-5">
              <p className="text-xs text-ink-muted">
                What happened when you left <span className="text-ink-faint">— this is the data most candidates say they wish they had before joining.</span>
              </p>
              <div>
                <label htmlFor="exit-letter" className={LABEL_CLS}>Did you receive your experience / relieving letter?</label>
                <select id="exit-letter" value={form.exit_experience_letter} onChange={(e) => set("exit_experience_letter", e.target.value as FormState["exit_experience_letter"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="on_time">Yes, on time</option>
                  <option value="delayed">Yes, but delayed</option>
                  <option value="not_received">No, never received it</option>
                  <option value="na">Doesn&apos;t apply to my exit</option>
                </select>
              </div>
              <div>
                <label htmlFor="exit-settlement" className={LABEL_CLS}>Was your full-and-final settlement paid on time?</label>
                <select id="exit-settlement" value={form.exit_settlement} onChange={(e) => set("exit_settlement", e.target.value as FormState["exit_settlement"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="on_time">Yes, on time</option>
                  <option value="delayed">Yes, but delayed</option>
                  <option value="not_received">No, never received it</option>
                  <option value="na">Doesn&apos;t apply to my exit</option>
                </select>
              </div>
              <div>
                <label htmlFor="exit-docs" className={LABEL_CLS}>Was your exit documentation (relieving letter, F&amp;F statement, PF/tax paperwork) complete?</label>
                <select id="exit-docs" value={form.exit_documentation} onChange={(e) => set("exit_documentation", e.target.value as FormState["exit_documentation"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="complete">Complete</option>
                  <option value="partial">Partial</option>
                  <option value="none">None of it</option>
                  <option value="na">Doesn&apos;t apply to my exit</option>
                </select>
              </div>
              <div>
                <label htmlFor="tenure" className={LABEL_CLS}>How long did you work there?</label>
                <select id="tenure" value={form.tenure_bucket} onChange={(e) => set("tenure_bucket", e.target.value as FormState["tenure_bucket"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="0-1">0–1 years</option>
                  <option value="1-3">1–3 years</option>
                  <option value="3-5">3–5 years</option>
                  <option value="5-8">5–8 years</option>
                  <option value="8+">8+ years</option>
                </select>
              </div>
            </div>
          )}

          {/* Culture step (employee + former_employee) — culture.ts +
              conduct.ts (migration 0020). All optional. The conduct question is
              deliberately a role-neutral environment scale, never about a named
              person — see conduct.ts's header for why. */}
          {stepKey === "culture" && (
            <div className="space-y-5">
              {form.relationship === "employee" && (
                <div>
                  <label htmlFor="tenure-emp" className={LABEL_CLS}>How long have you worked there?</label>
                  <select id="tenure-emp" value={form.tenure_bucket} onChange={(e) => set("tenure_bucket", e.target.value as FormState["tenure_bucket"])} className={SELECT_CLS}>
                    <option value="">Prefer not to say</option>
                    <option value="0-1">0–1 years</option>
                    <option value="1-3">1–3 years</option>
                    <option value="3-5">3–5 years</option>
                    <option value="5-8">5–8 years</option>
                    <option value="8+">8+ years</option>
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="recommend" className={LABEL_CLS}>Would you recommend working here?</label>
                <select id="recommend" value={form.would_recommend} onChange={(e) => set("would_recommend", e.target.value as FormState["would_recommend"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="yes">Yes</option>
                  <option value="maybe">Maybe, depends on the role</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                <label htmlFor="conduct" className={LABEL_CLS}>How would you describe the workplace environment?</label>
                <select id="conduct" value={form.conduct_environment} onChange={(e) => set("conduct_environment", e.target.value as FormState["conduct_environment"])} className={SELECT_CLS}>
                  <option value="">Prefer not to say</option>
                  <option value="respectful">Respectful</option>
                  <option value="mostly_ok">Mostly okay</option>
                  <option value="some_concerns">Some concerns</option>
                  <option value="serious_concerns">Serious concerns</option>
                  <option value="na">Not sure / doesn&apos;t apply</option>
                </select>
                <p className="text-xs text-ink-faint mt-1.5">
                  This is aggregated with other reports and never shown as a single individual account. It is not a substitute for reporting misconduct through a formal channel.
                </p>
              </div>
            </div>
          )}

          {/* Step 5 — Experience ratings + emotions. Entirely optional. */}
          {stepKey === "experience" && (
            <div className="space-y-6">
              <div className="border border-rule bg-paper rounded-sm p-3.5">
                <p className="text-xs text-ink-soft leading-relaxed">
                  <span className="font-semibold text-ink">Optional.</span>{" "}
                  Rate any of these to sharpen the company&apos;s fingerprint. Skip
                  what you don&apos;t want to answer — you can submit with none of it.
                </p>
              </div>

              {/* These facets (recruiter conduct, interviewer prep, process
                  clarity) describe an INTERVIEW — shown only to a candidate.
                  An employee/former_employee never went through this process,
                  so rating it would fabricate evidence they don't have. */}
              {form.relationship === "candidate" && LIKERT_DIMENSIONS.map((dim) => (
                <div key={dim.key}>
                  <h3 className="text-sm font-medium text-ink mb-1">{dim.label}</h3>
                  <div className="border border-rule bg-paper-sheet rounded-sm px-4 py-1">
                    {facetsForDimension(dim.key).map((facet) => (
                      <FacetRating
                        key={facet.key}
                        label={facet.label}
                        anchorLow={facet.anchorLow}
                        anchorHigh={facet.anchorHigh}
                        value={form.ratings[facet.key]}
                        onChange={(v) => setRating(facet.key, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {EMOTION_DIMENSION && (
                <div>
                  <h3 className="text-sm font-medium text-ink mb-1">{EMOTION_DIMENSION.label}</h3>
                  <p className="text-xs text-ink-faint mb-2.5">How did the process make you feel? Pick any that apply.</p>
                  <div className="flex flex-wrap gap-2">
                    {EMOTIONS.map((emotion) => {
                      const on = form.emotions.includes(emotion.key);
                      return (
                        <button
                          key={emotion.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleEmotion(emotion.key)}
                          className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                            on
                              ? "bg-accent border-accent text-paper-sheet"
                              : "border-rule-strong text-ink-soft bg-paper hover:border-ink-faint"
                          }`}
                        >
                          {emotion.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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

          {step < steps.length ? (
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
