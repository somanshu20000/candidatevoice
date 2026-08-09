export type HiringStage = "applied" | "screening" | "technical" | "hr" | "final";
export type HiringOutcome = "rejected" | "no_response" | "offer" | "ongoing";
export type ExperienceBucket = "0-1" | "1-3" | "3-5" | "5-8" | "8+";
export type ResponseTimeBucket = "0-3" | "4-7" | "8-14" | "15+";
export type LastInteractionGap = "0-7" | "8-14" | "15-30" | "30+";
export type CallDuration = "<2" | "2-5" | "5-15" | "15+" | "na";
export type FirstInteractionOutcome = "continued" | "rejected_immediately" | "na";
/**
 * How the candidate applied. First-party only (migration 0014) — a
 * third-party forum post cannot structurally know this, so external_reports
 * has no equivalent column. Optional at the form; a missing value just
 * excludes that report from channel-scoped cohort views, like any other
 * unanswered field.
 */
export type ApplicationChannel = "referral" | "recruiter_outreach" | "job_board" | "company_website" | "other";

/**
 * Compensation transparency & privacy practices (migration 0018). All
 * first-party only, all optional, and all CANDIDATE-KNOWABLE: each records
 * something the candidate directly experienced during hiring, not something
 * that requires having worked at the company.
 *
 * `null` means "did not answer" and is excluded from every metric. It is NOT
 * the same as the explicit `"never"` / `"none"` values, which are answers.
 * Conflating them would let silence manufacture either an accusation or a
 * clean record — see 0018's header.
 */
/** At what point (if ever) previous/current salary was asked for. */
export type SalaryHistoryStage = "never" | "application" | "screening" | "interview" | "offer";
/** What documentary proof of salary was demanded — an invasiveness ladder. */
export type SalaryProofType = "none" | "payslip" | "bank_statement" | "tax_document";
/** When that proof was demanded. After a written offer is ordinary; during screening is not. */
export type SalaryProofStage = "none" | "screening" | "interview" | "before_offer" | "after_offer";
/** When the company disclosed ITS range — the other side of the asymmetry. */
export type SalaryRangeDisclosed = "in_posting" | "before_first" | "before_final" | "at_offer" | "never";

/**
 * Reporter relationship (migration 0019). The one field that says which of the
 * three question sets a report belongs to. 'candidate' = interviewed here (the
 * only value before 0019); 'employee' = currently works here; 'former_employee'
 * = used to work here. External evidence is always interview-context, so it
 * normalises to 'candidate'.
 */
export type ReporterType = "candidate" | "employee" | "former_employee";

/**
 * Tenure-stage practices (migration 0019). First-party only, all optional, and
 * "NULL is not NO" like the 0018 salary fields: `null` = did not answer
 * (excluded from the metric), whereas `"na"` / `"none"` are real answers.
 * `"not_received"` is a FACT the reporter observed — never phrased as
 * "withheld"/"refused"; we do not infer a company's intent from a report.
 */
/** former_employee: experience/relieving letter received, and its timing. */
export type ExitExperienceLetter = "on_time" | "delayed" | "not_received" | "na";
/** former_employee: full-and-final settlement timing. */
export type ExitSettlement = "on_time" | "delayed" | "not_received" | "na";
/** former_employee: completeness of exit documentation. */
export type ExitDocumentation = "complete" | "partial" | "none" | "na";
/** employee: the single headline culture signal. */
export type WouldRecommend = "yes" | "maybe" | "no";
/** employee/former_employee: how long they worked here. Mirrors ExperienceBucket buckets. */
export type TenureBucket = "0-1" | "1-3" | "3-5" | "5-8" | "8+";
/**
 * employee/former_employee: workplace conduct environment. A role-neutral,
 * structured psychological-safety scale — NEVER free text, NEVER about a named
 * person. Its aggregate is gated far harder than any other field (conduct.ts:
 * CONDUCT_MIN_EFFECTIVE_N), because it is the only field touching
 * harassment/toxicity and a current employee at a small firm is identifiable.
 */
export type ConductEnvironment = "respectful" | "mostly_ok" | "some_concerns" | "serious_concerns" | "na";
/**
 * The furthest stage a submission reached, as shown on a card.
 *
 * These describe a STAGE, never an outcome. `final` means "reached the final
 * round" and says nothing about whether the candidate was rejected, ghosted,
 * offered, or is still waiting — that is `outcome`, a separate field.
 */
export type CardRejectionStage = "applied" | "screened" | "interviewed" | "final";

export interface SubmissionCardData {
  id: string;
  company: {
    id: string;
    slug: string;
    name: string;
    industry: string;
    domain: string;
  };
  role_title: string;
  rejection_stage: CardRejectionStage;
  rejection_reason: string;
  experience_text: string;
  /**
   * YYYY-MM, from the public_submissions view — never a precise timestamp.
   * Cards used to carry raw created_at; a to-the-second time alongside a
   * company and role narrows a report to one identifiable person.
   */
  reported_month: string | null;
}

export interface HiringSubmission {
  id: string;
  company: string;
  role: string;
  experience_bucket: ExperienceBucket;
  /** Nullable since migration 0020 — an employee/former_employee report never
   *  went through an interview process, so these four have no honest value. A
   *  candidate report must still supply them (enforced at the route). */
  stage: HiringStage | null;
  outcome: HiringOutcome | null;
  response_time_bucket: ResponseTimeBucket | null;
  last_interaction_gap: LastInteractionGap | null;
  call_duration: CallDuration | null;
  first_interaction_outcome: FirstInteractionOutcome | null;
  reason: string | null;
  payment_flag: boolean;
  is_approved: boolean;
  created_at: string;
  /** Soft-delete marker set by admin/reject — rejected rows are kept for audit history, not hard-deleted. */
  rejected_at?: string | null;
  /** Resolved canonical employer (migration 0002). Nullable: set at submit time
   *  via resolve_organization()/create-on-miss; null only if that resolution
   *  itself failed (fail-open — a submission is never dropped over it). */
  organization_id?: string | null;
  /** Which of the three relationships this report is (migration 0019).
   *  Defaults to 'candidate' when absent. */
  reporter_type?: ReporterType;
  /** Optional — see ApplicationChannel. Migration 0014. */
  application_channel?: ApplicationChannel | null;
  /** Compensation transparency & privacy (migration 0018). All optional;
   *  null means unanswered, never "no". */
  salary_history_stage?: SalaryHistoryStage | null;
  salary_proof_type?: SalaryProofType | null;
  salary_proof_stage?: SalaryProofStage | null;
  salary_range_disclosed?: SalaryRangeDisclosed | null;
  /** Tenure-stage practices (migration 0019). All optional; null means
   *  unanswered, never "no". See each type above. */
  exit_experience_letter?: ExitExperienceLetter | null;
  exit_settlement?: ExitSettlement | null;
  exit_documentation?: ExitDocumentation | null;
  would_recommend?: WouldRecommend | null;
  tenure_bucket?: TenureBucket | null;
  conduct_environment?: ConductEnvironment | null;
}

export type Database = {
  public: {
    Tables: {
      hiring_submissions: {
        Row: HiringSubmission;
        Insert: Omit<HiringSubmission, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<HiringSubmission>;
      }
    };
    Enums: Record<string, never>;
  };
};
