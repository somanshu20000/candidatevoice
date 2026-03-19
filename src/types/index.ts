export type RejectionStage = "applied" | "screened" | "interviewed" | "offered";

export interface SubmissionFormData {
  company_id: string;
  roleTitle: string;
  rejectionStage: RejectionStage;
  rejectionReason?: string;
  experienceText?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface Submission {
  id: string;
  company_id: string;
  role_title: string;
  rejection_stage: RejectionStage;
  rejection_reason: string | null;
  experience_text: string;
  sentiment_score: number | null;
  is_approved: boolean;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  logo_url: string | null;
}

export interface Moderation {
  id: string;
  submission_id: string;
  flagged_by: "hive" | "admin";
  reason: string;
  resolved_at: string | null;
}

export interface HiringSubmission {
  id?: string;
  company: string;
  role: string;
  experience_bucket: '0-1' | '1-3' | '3-5' | '5-8' | '8+';
  stage: 'applied' | 'screening' | 'technical' | 'hr' | 'final';
  outcome: 'rejected' | 'no_response' | 'offer' | 'withdrawn';
  response_time_bucket: '0-3' | '4-7' | '8-14' | '15+';
  last_interaction_gap: '0-7' | '8-14' | '15-30' | '30+';
  call_duration?: '<2' | '2-5' | '5-15' | '15+' | 'na';
  first_interaction_outcome?: 'continued' | 'rejected_immediately' | 'na';
  reason?: 'experience_mismatch' | 'skill_mismatch' | 'culture_fit' | 'no_reason' | 'other';
  payment_flag?: 'no' | 'before_interview' | 'after_interview' | 'training_fee';
  created_at?: string;
}

export type Database = {
  public: {
    Tables: {
      submissions: {
        Row: Submission;
        Insert: Omit<Submission, "id" | "created_at" | "sentiment_score" | "is_approved"> & {
          id?: string;
          sentiment_score?: number | null;
          is_approved?: boolean;
          created_at?: string;
        };
        Update: Partial<Submission>;
      };
      companies: {
        Row: Company;
        Insert: Omit<Company, "id"> & { id?: string };
        Update: Partial<Company>;
      };
      moderations: {
        Row: Moderation;
        Insert: Omit<Moderation, "id"> & { id?: string };
        Update: Partial<Moderation>;
      };
    };
    Enums: {
      rejection_stage: RejectionStage;
    };
  };
};
