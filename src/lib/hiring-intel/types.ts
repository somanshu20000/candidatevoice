/**
 * External hiring intelligence — canonical types.
 *
 * This subsystem ingests THIRD-PARTY hiring reports (initially Reddit) as a
 * cold-start bootstrap. It is deliberately separate from both first-party
 * evidence (src/types, hiring_submissions) and imported company metadata
 * (src/lib/company-intelligence). An external report is a claim someone made in
 * public — never candidate testimony, never a company fact — and the schema
 * keeps it provably distinct (see migration 0008).
 *
 * THE ACQUISITION BOUNDARY. An acquisition adapter (any language) produces
 * `RawExternalReport` objects — structured fields plus a source link, and
 * NOTHING ELSE. There is deliberately no field for the original post body: the
 * contract cannot carry it, so a downstream bug cannot republish it. The
 * source-agnostic core (normalize → validate → dedupe → persist as pending)
 * consumes that contract regardless of where the records came from, which is
 * what lets a source be swapped or removed without touching the application.
 */

// Closed vocabularies — identical to hiring_submissions so a blended score can
// run one estimator over both families. Kept as plain arrays that mirror the
// CHECK constraints in migration 0008 exactly.
export const EXPERIENCE_BUCKETS = ["0-1", "1-3", "3-5", "5-8", "8+"] as const;
export const STAGES = ["applied", "screening", "technical", "hr", "final"] as const;
export const OUTCOMES = ["rejected", "no_response", "offer", "ongoing"] as const;
export const RESPONSE_TIME_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
export const LAST_INTERACTION_GAPS = ["0-7", "8-14", "15-30", "30+"] as const;
export const REASONS = ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other"] as const;

export type ExperienceBucket = (typeof EXPERIENCE_BUCKETS)[number];
export type Stage = (typeof STAGES)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type ResponseTimeBucket = (typeof RESPONSE_TIME_BUCKETS)[number];
export type LastInteractionGap = (typeof LAST_INTERACTION_GAPS)[number];
export type Reason = (typeof REASONS)[number];

/**
 * The canonical record an acquisition adapter emits — one JSON object per line
 * of a JSONL file. `company` and `source_url` are required; everything else is
 * an optional extracted fact. There is NO body/text/quote field, by design.
 */
export interface RawExternalReport {
  /** Employer name as extracted, e.g. "Google". Required. */
  company: string;
  /** Role/title if stated, e.g. "Software Engineer". */
  role?: string;
  /** Link back to the original post. Required — this is the attribution. */
  source_url: string;
  /** Stable id from the source (e.g. a Reddit post id) for exact dedup. */
  external_ref?: string;

  experience_bucket?: string;
  stage?: string;
  outcome?: string;
  response_time_bucket?: string;
  last_interaction_gap?: string;
  reason?: string;
  /** Whether the candidate was asked to pay. */
  payment_flag?: boolean;
  /** Coarsened original date, YYYY-MM. Never an exact timestamp. */
  reported_month?: string;
}

/** A cleaned, validated report ready to persist as a pending external row. */
export interface NormalizedExternalReport {
  company: string;
  companySlug: string;
  role: string | null;
  sourceUrl: string;
  externalRef: string | null;
  experienceBucket: ExperienceBucket | null;
  stage: Stage | null;
  outcome: Outcome | null;
  responseTimeBucket: ResponseTimeBucket | null;
  lastInteractionGap: LastInteractionGap | null;
  reason: Reason | null;
  paymentFlag: boolean | null;
  reportedMonth: string | null;
  /** SHA-256 of the normalized structured fields — the dedup / idempotency key. */
  contentHash: string;
}

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidatedExternalReport {
  normalized: NormalizedExternalReport | null;
  issues: ValidationIssue[];
}

/**
 * An acquisition adapter turns a source into RawExternalReport[]. It does no
 * cleaning, validation or database work — those are the core's job, shared
 * across every source. In practice adapters may live in other languages and
 * emit the JSONL contract instead of implementing this interface directly; this
 * type documents the shape either way.
 */
export interface AcquisitionAdapter {
  /** Matches an external_sources.key row, e.g. "reddit". */
  readonly key: string;
  readonly displayName: string;
  load(input: unknown): Promise<RawExternalReport[]>;
}

export interface ExternalImportReport {
  sourceKey: string;
  total: number;
  created: number;
  duplicate: number;
  invalid: number;
  dryRun: boolean;
  issues: { company: string; issues: ValidationIssue[] }[];
}
