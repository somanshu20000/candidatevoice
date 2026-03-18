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
