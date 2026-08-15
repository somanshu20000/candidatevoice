/**
 * Evidence Engine — raw view rows → EvidenceItem[]. PURE. No I/O, no clock, no
 * Supabase import. This is what makes the trust-critical weighting arithmetic
 * unit-testable without a database (ADR-0002's confirmed engine-locus decision).
 */

import type {
  HiringStage,
  HiringOutcome,
  ExperienceBucket,
  ResponseTimeBucket,
  LastInteractionGap,
  CallDuration,
  FirstInteractionOutcome,
  ApplicationChannel,
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
  VerificationTier,
} from "@/types/index";
import type { EvidenceItem } from "./types";
import type { RawFirstPartyRow, RawExternalRow } from "./load";
import { firstPartyWeight, externalWeight } from "./weight";

const STAGES: readonly string[] = ["applied", "screening", "technical", "hr", "final"];
const OUTCOMES: readonly string[] = ["rejected", "no_response", "offer", "ongoing"];
const EXPERIENCE_BUCKETS: readonly string[] = ["0-1", "1-3", "3-5", "5-8", "8+"];
const RESPONSE_TIME_BUCKETS: readonly string[] = ["0-3", "4-7", "8-14", "15+"];
const LAST_INTERACTION_GAPS: readonly string[] = ["0-7", "8-14", "15-30", "30+"];
const CALL_DURATIONS: readonly string[] = ["<2", "2-5", "5-15", "15+", "na"];
const FIRST_INTERACTION_OUTCOMES: readonly string[] = ["continued", "rejected_immediately", "na"];
const APPLICATION_CHANNELS: readonly string[] = ["referral", "recruiter_outreach", "job_board", "company_website", "other"];
// Compensation transparency & privacy (migration 0018). Note "never"/"none"
// are real ANSWERS here, not absence — an unanswered field arrives as null and
// asEnum keeps it null, which every metric treats as ineligible.
const SALARY_HISTORY_STAGES: readonly string[] = ["never", "application", "screening", "interview", "offer"];
const SALARY_PROOF_TYPES: readonly string[] = ["none", "payslip", "bank_statement", "tax_document"];
const SALARY_PROOF_STAGES: readonly string[] = ["none", "screening", "interview", "before_offer", "after_offer"];
const SALARY_RANGE_DISCLOSURES: readonly string[] = ["in_posting", "before_first", "before_final", "at_offer", "never"];
// Tenure stages (migration 0020). "na"/"none" are answers, not absence; a null
// arrives from an unanswered field and asEnum keeps it null (ineligible).
const REPORTER_TYPES: readonly string[] = ["candidate", "employee", "former_employee"];
const EXIT_EXPERIENCE_LETTERS: readonly string[] = ["on_time", "delayed", "not_received", "na"];
const EXIT_SETTLEMENTS: readonly string[] = ["on_time", "delayed", "not_received", "na"];
const EXIT_DOCUMENTATIONS: readonly string[] = ["complete", "partial", "none", "na"];
const WOULD_RECOMMENDS: readonly string[] = ["yes", "maybe", "no"];
const TENURE_BUCKETS: readonly string[] = ["0-1", "1-3", "3-5", "5-8", "8+"];
const CONDUCT_ENVIRONMENTS: readonly string[] = ["respectful", "mostly_ok", "some_concerns", "serious_concerns", "na"];
// Verification provenance (migrations 0027/0028). A coarse enum, never a weight
// (D-022). An unrecognized or null value falls back to 'unverified' below —
// the safe default, matching how the column defaults at the DB.
const VERIFICATION_TIERS: readonly string[] = ["unverified", "inbox_verified", "contact_domain", "attested"];

/**
 * Narrow a raw string to its enum type, or null. The DB's own CHECK
 * constraints already guarantee validity at the source (this is defensive,
 * not a real-world failure mode) — but a metric silently scoring a stray value
 * is exactly the class of bug 0000's own comment on hqs.ts warns about
 * ("bad data would score rather than fail"), so unrecognized values are
 * dropped to null (excluded from that field's coverage) rather than passed through.
 */
function asEnum<T extends string>(value: string | null, allowed: readonly string[]): T | null {
  if (value === null) return null;
  return allowed.includes(value) ? (value as T) : null;
}

function asMonth(value: string | null): string | null {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : null;
}

function asConfidence(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeFirstParty(rows: RawFirstPartyRow[]): EvidenceItem[] {
  const weight = firstPartyWeight();
  return rows
    .filter((r): r is RawFirstPartyRow & { organization_id: string } => r.organization_id !== null)
    .map((r) => ({
      id: r.id,
      family: "first_party" as const,
      sourceKey: "candidatevoice",
      organizationId: r.organization_id,
      weight,
      reportedMonth: asMonth(r.reported_month),
      // Default to 'candidate' when the column is null/unrecognized — a report
      // that predates 0020 or arrives without the field is an interview report.
      reporterType: asEnum<ReporterType>(r.reporter_type, REPORTER_TYPES) ?? "candidate",
      stage: asEnum<HiringStage>(r.stage, STAGES),
      outcome: asEnum<HiringOutcome>(r.outcome, OUTCOMES),
      experienceBucket: asEnum<ExperienceBucket>(r.experience_bucket, EXPERIENCE_BUCKETS),
      responseTimeBucket: asEnum<ResponseTimeBucket>(r.response_time_bucket, RESPONSE_TIME_BUCKETS),
      lastInteractionGap: asEnum<LastInteractionGap>(r.last_interaction_gap, LAST_INTERACTION_GAPS),
      reason: r.reason,
      paymentFlag: r.payment_flag,
      callDuration: asEnum<CallDuration>(r.call_duration, CALL_DURATIONS),
      firstInteractionOutcome: asEnum<FirstInteractionOutcome>(r.first_interaction_outcome, FIRST_INTERACTION_OUTCOMES),
      applicationChannel: asEnum<ApplicationChannel>(r.application_channel, APPLICATION_CHANNELS),
      salaryHistoryStage: asEnum<SalaryHistoryStage>(r.salary_history_stage, SALARY_HISTORY_STAGES),
      salaryProofType: asEnum<SalaryProofType>(r.salary_proof_type, SALARY_PROOF_TYPES),
      salaryProofStage: asEnum<SalaryProofStage>(r.salary_proof_stage, SALARY_PROOF_STAGES),
      salaryRangeDisclosed: asEnum<SalaryRangeDisclosed>(r.salary_range_disclosed, SALARY_RANGE_DISCLOSURES),
      exitExperienceLetter: asEnum<ExitExperienceLetter>(r.exit_experience_letter, EXIT_EXPERIENCE_LETTERS),
      exitSettlement: asEnum<ExitSettlement>(r.exit_settlement, EXIT_SETTLEMENTS),
      exitDocumentation: asEnum<ExitDocumentation>(r.exit_documentation, EXIT_DOCUMENTATIONS),
      wouldRecommend: asEnum<WouldRecommend>(r.would_recommend, WOULD_RECOMMENDS),
      tenureBucket: asEnum<TenureBucket>(r.tenure_bucket, TENURE_BUCKETS),
      conductEnvironment: asEnum<ConductEnvironment>(r.conduct_environment, CONDUCT_ENVIRONMENTS),
      extractionConfidence: null, // first-party has no extraction step
      // Coarse provenance metadata, not a weight (D-022). `weight` above was
      // computed with no reference to this field and never will be.
      verificationTier: asEnum<VerificationTier>(r.verification_tier, VERIFICATION_TIERS) ?? "unverified",
    }));
}

/**
 * `globalMultiplier` is threaded in as a plain argument rather than fetched
 * here, keeping this function pure — the async settings read happens once in
 * index.ts and is reused for every item, not re-fetched per row.
 */
export function normalizeExternal(rows: RawExternalRow[], globalMultiplier: number): EvidenceItem[] {
  return rows
    .filter((r): r is RawExternalRow & { organization_id: string } => r.organization_id !== null)
    .map((r) => {
      const extractionConfidence = asConfidence(r.extraction_confidence);
      const weight = externalWeight({
        sourceTrust: Number(r.trust_weight),
        extractionConfidence,
        // public_external_reports only ever contains approved rows (it filters
        // verification_status = 'approved' in its own definition) — but passed
        // explicitly rather than hardcoded, per weight.ts's own rationale.
        status: "approved",
        globalMultiplier,
      });
      return {
        id: r.id,
        family: "external" as const,
        sourceKey: r.source_key,
        organizationId: r.organization_id,
        weight,
        reportedMonth: asMonth(r.reported_month),
        // External evidence is always interview-context — a third-party forum
        // post about a company is a candidate's account, never an employee's
        // structured culture/exit report. So it is 'candidate', and every
        // tenure-only field below is null (W1 asymmetry).
        reporterType: "candidate" as ReporterType,
        stage: asEnum<HiringStage>(r.stage, STAGES),
        outcome: asEnum<HiringOutcome>(r.outcome, OUTCOMES),
        experienceBucket: asEnum<ExperienceBucket>(r.experience_bucket, EXPERIENCE_BUCKETS),
        responseTimeBucket: asEnum<ResponseTimeBucket>(r.response_time_bucket, RESPONSE_TIME_BUCKETS),
        lastInteractionGap: asEnum<LastInteractionGap>(r.last_interaction_gap, LAST_INTERACTION_GAPS),
        reason: r.reason,
        paymentFlag: r.payment_flag,
        // Field asymmetry, not a mapping bug (ADR-0002 W1): external_reports has
        // no equivalent columns at all.
        callDuration: null,
        firstInteractionOutcome: null,
        applicationChannel: null,
        salaryHistoryStage: null,
        salaryProofType: null,
        salaryProofStage: null,
        salaryRangeDisclosed: null,
        exitExperienceLetter: null,
        exitSettlement: null,
        exitDocumentation: null,
        wouldRecommend: null,
        tenureBucket: null,
        conductEnvironment: null,
        extractionConfidence,
        // A third-party forum post carries no verification grant — external
        // evidence is always 'unverified' (W1 asymmetry, same as the fields above).
        verificationTier: "unverified" as VerificationTier,
      };
    });
}
