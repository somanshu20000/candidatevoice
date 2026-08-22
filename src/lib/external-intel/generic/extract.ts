/**
 * Generic EXTRACTOR — maps ParsedRecord[] (generic/parser.ts) onto the
 * EXISTING CandidateVoice evidence contract (RawExternalReport,
 * hiring-intel/types.ts). Owns no browser and no HTML parsing — it only
 * translates already-parsed strings into the closed evidence vocabulary.
 *
 * TWO HARD RULES, both inherited from the rest of this codebase:
 *  1. ONLY existing dimensions (Task 3 req 7) — never invent a metric. A
 *     parsed value that maps to no known enum is DROPPED for that field
 *     (left undefined), never coerced or stored raw.
 *  2. Canonicalization + content hash EXACTLY as
 *     src/lib/hiring-intel/normalize.ts's hashContent (replicated inline,
 *     same reason D-033/D-034 gave: stay independent of in-flight
 *     collaborator changes to hiring-intel/{store,types}.ts). This is what
 *     makes ingestion idempotent without assuming a DB unique constraint.
 *
 * Provenance (Task 3 req 8) rides on every record: source_url, external_ref,
 * content_hash, extraction_version, extraction_confidence, plus a
 * _provenance blob (acquired_at, extraction_method, raw-HTML hash) the
 * caller persists into external_reports.fields_extracted.
 */

import { createHash } from "crypto";
import type { RawExternalReport } from "../../hiring-intel/types";
import type { ParsedRecord } from "./parser";

export const GENERIC_EXTRACTOR_VERSION = "generic-v1";

// Closed vocabularies — mirror hiring-intel/types.ts / the DB CHECKs. A
// value not present here maps to undefined (dropped), never invented.
const STAGES = ["applied", "screening", "technical", "hr", "final"] as const;
const OUTCOMES = ["rejected", "no_response", "offer", "ongoing"] as const;
const EXPERIENCE_BUCKETS = ["0-1", "1-3", "3-5", "5-8", "8+"] as const;
const RESPONSE_TIME_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
const LAST_INTERACTION_GAPS = ["0-7", "8-14", "15-30", "30+"] as const;
const REASONS = ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other"] as const;

/** Human phrasings a listing page might use, mapped to the enum. Anything
 *  not matched returns undefined (the field is simply absent, never guessed). */
function mapOutcome(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/(no response|ghost|never heard)/.test(s)) return "no_response";
  if (/(offer|hired|accepted)/.test(s)) return "offer";
  if (/(reject|declined|turned down)/.test(s)) return "rejected";
  if (/(ongoing|in progress|pending|waiting)/.test(s)) return "ongoing";
  return undefined;
}

function mapStage(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (/(applied|application)/.test(s)) return "applied";
  if (/(screen|phone|recruiter call)/.test(s)) return "screening";
  if (/(technical|coding|assessment|take.?home)/.test(s)) return "technical";
  if (/\bhr\b|managerial|behavioural/.test(s)) return "hr";
  if (/(final|onsite|last round)/.test(s)) return "final";
  return undefined;
}

function mapEnum(raw: string | null, allowed: readonly string[]): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s);
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Coarsen a parsed date string to YYYY-MM. Deliberately does NOT use
 * Date.parse — a TZ-less string ("March 2026") parses as local midnight,
 * and reading UTC components then skews it across the month boundary
 * (caught in test: IST turned "March 2026" into "2026-02"). Handles the two
 * realistic source formats explicitly and returns undefined for anything
 * else — never guesses, never today().
 */
function mapReportedMonth(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const iso = raw.match(/(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const named = raw.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})/);
  if (named) return `${named[2]}-${MONTHS[named[1]]}`;
  return undefined;
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, "-");
}

/** Canonical content hash — byte-identical field order to
 *  src/lib/hiring-intel/normalize.ts's hashContent. */
export function canonicalContentHash(fields: {
  companySlug: string; role: string; experienceBucket: string; stage: string;
  outcome: string; responseTimeBucket: string; lastInteractionGap: string;
  reason: string; paymentFlag: string; reportedMonth: string;
}): string {
  const canonical = [
    fields.companySlug, fields.role, fields.experienceBucket, fields.stage,
    fields.outcome, fields.responseTimeBucket, fields.lastInteractionGap,
    fields.reason, fields.paymentFlag, fields.reportedMonth,
  ].join("");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ExtractedReport {
  report: RawExternalReport;
  contentHash: string;
  /** Provenance for external_reports.fields_extracted. */
  provenance: {
    acquiredAt: string;
    extractionMethod: string;
    extractorVersion: string;
    sourcePageUrl: string;
    rawHtmlHash: string;
  };
}

export interface ExtractInput {
  records: ParsedRecord[];
  /** The page these records were parsed from (provenance + source_url base). */
  sourcePageUrl: string;
  /** Hash of the raw HTML the parser was given (provenance). */
  rawHtmlHash: string;
  acquiredAt: string;
  /** Attributes a per-record source_url; defaults to sourcePageUrl + #ref. */
  sourceUrlFor?: (rec: ParsedRecord, index: number) => string;
}

export interface ExtractResult {
  extracted: ExtractedReport[];
  droppedPartial: number;
  droppedNoDimension: number;
  dedupedInBatch: number;
}

/**
 * Map parsed records to evidence reports. Drops: partial records (no
 * company), records that yield NO usable evidence dimension (a row with
 * only a company name is not evidence of anything), and in-batch duplicates
 * (same content_hash). Never throws; a malformed field just maps to
 * undefined.
 */
export function extractReports(input: ExtractInput): ExtractResult {
  const extracted: ExtractedReport[] = [];
  const seenHashes = new Set<string>();
  let droppedPartial = 0;
  let droppedNoDimension = 0;
  let dedupedInBatch = 0;

  input.records.forEach((rec, index) => {
    if (rec.partial || !rec.company) {
      droppedPartial += 1;
      return;
    }
    const stage = mapStage(rec.stage);
    const outcome = mapOutcome(rec.outcome);
    const experienceBucket = mapEnum(rec.experience, EXPERIENCE_BUCKETS);
    const responseTimeBucket = mapEnum(rec.responseTime, RESPONSE_TIME_BUCKETS);
    const lastInteractionGap = mapEnum(rec.lastGap, LAST_INTERACTION_GAPS);
    const reason = mapEnum(rec.reason, REASONS);
    const reportedMonth = mapReportedMonth(rec.reportedDate);

    // A record with a company but no mappable dimension is not evidence.
    if (!stage && !outcome && !experienceBucket && !responseTimeBucket && !lastInteractionGap && !reason) {
      droppedNoDimension += 1;
      return;
    }

    const companySlug = slugify(rec.company);
    const contentHash = canonicalContentHash({
      companySlug,
      role: rec.role ?? "",
      experienceBucket: experienceBucket ?? "",
      stage: stage ?? "",
      outcome: outcome ?? "",
      responseTimeBucket: responseTimeBucket ?? "",
      lastInteractionGap: lastInteractionGap ?? "",
      reason: reason ?? "",
      paymentFlag: "false",
      reportedMonth: reportedMonth ?? "",
    });

    if (seenHashes.has(contentHash)) {
      dedupedInBatch += 1;
      return;
    }
    seenHashes.add(contentHash);

    const sourceUrl = input.sourceUrlFor
      ? input.sourceUrlFor(rec, index)
      : `${input.sourcePageUrl}#${rec.externalRef ?? `rec-${index}`}`;

    const report: RawExternalReport = {
      company: rec.company,
      role: rec.role ?? undefined,
      source_url: sourceUrl,
      external_ref: rec.externalRef ?? `${companySlug}-${contentHash.slice(0, 12)}`,
      experience_bucket: experienceBucket,
      stage,
      outcome,
      response_time_bucket: responseTimeBucket,
      last_interaction_gap: lastInteractionGap,
      reason,
      reported_month: reportedMonth,
      extraction_version: GENERIC_EXTRACTOR_VERSION,
      extraction_confidence: 0.7, // structured-HTML extraction; mid-high, same band as demo-seed
    };

    extracted.push({
      report,
      contentHash,
      provenance: {
        acquiredAt: input.acquiredAt,
        extractionMethod: "playwright+node-html-parser",
        extractorVersion: GENERIC_EXTRACTOR_VERSION,
        sourcePageUrl: input.sourcePageUrl,
        rawHtmlHash: input.rawHtmlHash,
      },
    });
  });

  return { extracted, droppedPartial, droppedNoDimension, dedupedInBatch };
}
