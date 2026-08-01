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
  stage: HiringStage;
  outcome: HiringOutcome;
  response_time_bucket: ResponseTimeBucket;
  last_interaction_gap: LastInteractionGap;
  call_duration: CallDuration;
  first_interaction_outcome: FirstInteractionOutcome;
  reason: string;
  payment_flag: boolean;
  is_approved: boolean;
  created_at: string;
  /** Soft-delete marker set by admin/reject — rejected rows are kept for audit history, not hard-deleted. */
  rejected_at?: string | null;
  /** Resolved canonical employer (migration 0002). Nullable: set at submit time
   *  via resolve_organization()/create-on-miss; null only if that resolution
   *  itself failed (fail-open — a submission is never dropped over it). */
  organization_id?: string | null;
  /** Always 'candidate' today — see migration 0000. */
  reporter_type?: string;
  /** Optional — see ApplicationChannel. Migration 0014. */
  application_channel?: ApplicationChannel | null;
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
