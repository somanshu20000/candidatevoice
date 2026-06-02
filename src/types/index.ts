export type HiringStage = "applied" | "screening" | "technical" | "hr" | "final";
export type HiringOutcome = "rejected" | "no_response" | "offer" | "ongoing";
export type ExperienceBucket = "0-1" | "1-3" | "3-5" | "5-8" | "8+";
export type ResponseTimeBucket = "0-3" | "4-7" | "8-14" | "15+";
export type LastInteractionGap = "0-7" | "8-14" | "15-30" | "30+";
export type CallDuration = "<2" | "2-5" | "5-15" | "15+" | "na";
export type FirstInteractionOutcome = "continued" | "rejected_immediately" | "na";
export type CardRejectionStage = "applied" | "screened" | "interviewed" | "offered";

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
  created_at: string;
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
