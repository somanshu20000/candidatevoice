/**
 * External hiring intelligence — normalization and validation.
 *
 * Turns a loosely-shaped RawExternalReport into a NormalizedExternalReport, or
 * rejects it. Pure and deterministic: same input → same output → same content
 * hash, which is what makes re-import idempotent. An unknown enum value becomes
 * null (recorded as a warning), never a fabricated value — a gap must read as
 * "unknown", not as data.
 *
 * Deliberately drops any unexpected field on the input, including a body/text
 * field an adapter might mistakenly include: only the structured contract is
 * carried forward, so the original post text cannot leak into the database.
 */

import { createHash } from "crypto";
import { normalizeCompanySlug } from "@/lib/company-slug";
import {
  EXPERIENCE_BUCKETS,
  STAGES,
  OUTCOMES,
  RESPONSE_TIME_BUCKETS,
  LAST_INTERACTION_GAPS,
  REASONS,
  type ExperienceBucket,
  type LastInteractionGap,
  type NormalizedExternalReport,
  type Outcome,
  type RawExternalReport,
  type Reason,
  type ResponseTimeBucket,
  type Stage,
  type ValidatedExternalReport,
  type ValidationIssue,
} from "./types";

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/** Coerce to a known enum value, or null. Pushes a warning when it drops one. */
function toEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  issues: ValidationIssue[]
): T | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if ((allowed as readonly string[]).includes(s)) return s as T;
  issues.push({ field, severity: "warning", message: `dropped unrecognized value "${s}"` });
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(s)) return true;
    if (["false", "no", "0"].includes(s)) return false;
  }
  return null;
}

function toReportedMonth(value: unknown): string | null {
  const s = cleanString(value, 7);
  if (!s) return null;
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

function normalizeUrl(value: unknown): string | null {
  const s = cleanString(value, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * SHA-256 over the structured fields in a fixed key order. `source_url` and
 * `external_ref` are excluded so that the SAME report reached by two different
 * URLs still deduplicates on content; `external_ref` handles exact-post dedup
 * separately at the database level.
 */
function hashContent(fields: {
  companySlug: string;
  role: string | null;
  experienceBucket: string | null;
  stage: string | null;
  outcome: string | null;
  responseTimeBucket: string | null;
  lastInteractionGap: string | null;
  reason: string | null;
  paymentFlag: boolean | null;
  reportedMonth: string | null;
}): string {
  const canonical = [
    fields.companySlug,
    fields.role ?? "",
    fields.experienceBucket ?? "",
    fields.stage ?? "",
    fields.outcome ?? "",
    fields.responseTimeBucket ?? "",
    fields.lastInteractionGap ?? "",
    fields.reason ?? "",
    fields.paymentFlag === null ? "" : String(fields.paymentFlag),
    fields.reportedMonth ?? "",
  ].join("");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Normalize and validate one raw record. */
export function normalizeExternalReport(raw: RawExternalReport): ValidatedExternalReport {
  const issues: ValidationIssue[] = [];

  const company = cleanString(raw.company, 200);
  if (!company) {
    issues.push({ field: "company", severity: "error", message: "company is required" });
  }
  const companySlug = company ? normalizeCompanySlug(company) : "";
  if (company && !companySlug) {
    issues.push({ field: "company", severity: "error", message: "company did not normalize to a slug" });
  }

  const sourceUrl = normalizeUrl(raw.source_url);
  if (!sourceUrl) {
    issues.push({ field: "source_url", severity: "error", message: "a valid http(s) source_url is required" });
  }

  // Contract guard. An acquisition adapter must emit structured fields plus a
  // link — nothing else. Storing the original post body/title/author is the one
  // thing this whole design exists to prevent, so if a record smuggles one,
  // REJECT it loudly rather than silently dropping the field: a body in the
  // input means an adapter is misbehaving, and we want to know. (The schema and
  // store also cannot persist these, so this is defence in depth, not the only
  // line — but it is the loudest.)
  for (const forbidden of ["body", "text", "title", "selftext", "content", "quote", "author", "username"]) {
    if (Object.prototype.hasOwnProperty.call(raw, forbidden)) {
      issues.push({
        field: forbidden,
        severity: "error",
        message: `forbidden field "${forbidden}" — only structured fields and a source link may be ingested`,
      });
    }
  }

  const role = cleanString(raw.role, 120);
  const experienceBucket = toEnum<ExperienceBucket>(raw.experience_bucket, EXPERIENCE_BUCKETS, "experience_bucket", issues);
  const stage = toEnum<Stage>(raw.stage, STAGES, "stage", issues);
  const outcome = toEnum<Outcome>(raw.outcome, OUTCOMES, "outcome", issues);
  const responseTimeBucket = toEnum<ResponseTimeBucket>(raw.response_time_bucket, RESPONSE_TIME_BUCKETS, "response_time_bucket", issues);
  const lastInteractionGap = toEnum<LastInteractionGap>(raw.last_interaction_gap, LAST_INTERACTION_GAPS, "last_interaction_gap", issues);
  const reason = toEnum<Reason>(raw.reason, REASONS, "reason", issues);
  const paymentFlag = toBoolean(raw.payment_flag);
  const reportedMonth = toReportedMonth(raw.reported_month);
  const externalRef = cleanString(raw.external_ref, 200);

  // A report with a company and a link but not a single extracted signal is
  // noise — it would contribute nothing to a score and only clutters the queue.
  const hasSignal =
    experienceBucket || stage || outcome || responseTimeBucket || lastInteractionGap || reason || paymentFlag !== null;
  if (company && sourceUrl && !hasSignal) {
    issues.push({ field: "*", severity: "error", message: "no usable hiring signal extracted (all fields empty)" });
  }

  if (issues.some((i) => i.severity === "error")) {
    return { normalized: null, issues };
  }

  const contentHash = hashContent({
    companySlug,
    role,
    experienceBucket,
    stage,
    outcome,
    responseTimeBucket,
    lastInteractionGap,
    reason,
    paymentFlag,
    reportedMonth,
  });

  // --- Explainability trail -------------------------------------------------
  // extraction_version / confidence come from the adapter (it did the work);
  // fields_extracted and validation_warnings are DERIVED here, so a stored row
  // always carries what actually happened to it, not the adapter's say-so.
  const extractionVersion = cleanString(raw.extraction_version, 60);
  let extractionConfidence: number | null = null;
  if (typeof raw.extraction_confidence === "number" && Number.isFinite(raw.extraction_confidence)) {
    if (raw.extraction_confidence >= 0 && raw.extraction_confidence <= 1) {
      extractionConfidence = raw.extraction_confidence;
    } else {
      issues.push({ field: "extraction_confidence", severity: "warning", message: "out of [0,1] range; dropped" });
    }
  }

  const fieldsExtracted = (
    [
      ["role", role],
      ["experience_bucket", experienceBucket],
      ["stage", stage],
      ["outcome", outcome],
      ["response_time_bucket", responseTimeBucket],
      ["last_interaction_gap", lastInteractionGap],
      ["reason", reason],
      ["payment_flag", paymentFlag],
      ["reported_month", reportedMonth],
    ] as const
  )
    .filter(([, v]) => v !== null)
    .map(([k]) => k);

  const validationWarnings = issues
    .filter((i) => i.severity === "warning")
    .map((i) => ({ field: i.field, message: i.message }));

  return {
    normalized: {
      company: company as string,
      companySlug,
      role,
      sourceUrl: sourceUrl as string,
      externalRef,
      experienceBucket,
      stage,
      outcome,
      responseTimeBucket,
      lastInteractionGap,
      reason,
      paymentFlag,
      reportedMonth,
      contentHash,
      extractionVersion,
      extractionConfidence,
      fieldsExtracted,
      validationWarnings,
    },
    issues,
  };
}
