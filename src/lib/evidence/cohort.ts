/**
 * Cohort filtering — the "Evidence Match" mechanism.
 *
 * WHY THIS EXISTS
 * The honest alternative to an ATS score. Instead of inventing a resume-match
 * percentage against a fabricated set of company weights, a candidate tells
 * CandidateVoice two true facts about themselves — years of experience, how
 * they'd apply — and sees the REAL forecast for people who reported the same.
 * "38 people with 3–5 years who applied via referral: 71% got an offer" is a
 * measurement. "Your resume scores 73%" is a guess. This module only ever
 * produces the former.
 *
 * ZERO NEW FORMULAS. `filterByCohort` is a plain predicate filter over fields
 * the engine already carries; `scopeToCohort` re-runs `describeBase` on the
 * filtered subset. Every downstream consumer — buildBehaviouralFingerprint,
 * buildForecast, computeHqs — is the exact same function called on a smaller
 * EvidenceItem[]. Suppression, coverage, and the sunset invariant all
 * continue to hold because nothing about their contract changed; they were
 * always "whatever items you hand me," and a cohort is just fewer items.
 */

import type { EvidenceItem, EvidenceSet } from "./types";
import { describeBase } from "./aggregate";
import type { ExperienceBucket, ApplicationChannel } from "@/types/index";

/**
 * Both dimensions are OPTIONAL and independent — omitting a key means "no
 * constraint on that dimension," not "match items where it's null." This is
 * the natural shape for URL query params, where a missing param means the
 * visitor didn't pick a value, not that they asked for unreported rows.
 */
export interface CohortFilter {
  experienceBucket?: ExperienceBucket;
  applicationChannel?: ApplicationChannel;
}

/** True when the filter constrains nothing — the "everyone" / cleared state. */
export function isEmptyCohort(filter: CohortFilter): boolean {
  return filter.experienceBucket === undefined && filter.applicationChannel === undefined;
}

/**
 * Filter evidence to items matching every constraint the cohort specifies.
 * An item missing the field a filter dimension asks about is excluded — the
 * same behaviour as every other predicate in this engine (a null field is
 * never a wildcard match). Returns the SAME array reference when the filter
 * is empty, so the common "no cohort selected" path costs nothing.
 */
export function filterByCohort(items: EvidenceItem[], filter: CohortFilter): EvidenceItem[] {
  if (isEmptyCohort(filter)) return items;
  return items.filter((item) => {
    if (filter.experienceBucket !== undefined && item.experienceBucket !== filter.experienceBucket) return false;
    if (filter.applicationChannel !== undefined && item.applicationChannel !== filter.applicationChannel) return false;
    return true;
  });
}

/**
 * Build a fresh EvidenceSet scoped to a cohort — `base` is ALWAYS recomputed
 * from the filtered items, never inherited from the parent set. A cohort of
 * 2 people must show effectiveN=2 and suppress downstream exactly like any
 * other thin evidence set; reusing the parent's base would silently borrow
 * confidence the cohort itself doesn't have.
 */
export function scopeToCohort(evidenceSet: EvidenceSet, filter: CohortFilter): EvidenceSet {
  const items = filterByCohort(evidenceSet.items, filter);
  return {
    organizationId: evidenceSet.organizationId,
    items,
    base: describeBase(items),
    globalMultiplier: evidenceSet.globalMultiplier,
  };
}

export const EXPERIENCE_BUCKET_LABELS: Record<ExperienceBucket, string> = {
  "0-1": "0–1 years",
  "1-3": "1–3 years",
  "3-5": "3–5 years",
  "5-8": "5–8 years",
  "8+": "8+ years",
};

export const APPLICATION_CHANNEL_LABELS: Record<ApplicationChannel, string> = {
  referral: "a referral",
  recruiter_outreach: "recruiter outreach",
  job_board: "a job board",
  company_website: "the company website",
  other: "another channel",
};

/**
 * Plain-language description of an active cohort, for the panel subtitle —
 * e.g. "3–5 years of experience, applying via a referral". Returns null for
 * the empty cohort so a caller can decide whether to render a subtitle at all.
 */
export function describeCohort(filter: CohortFilter): string | null {
  const parts: string[] = [];
  if (filter.experienceBucket !== undefined) parts.push(EXPERIENCE_BUCKET_LABELS[filter.experienceBucket]);
  if (filter.applicationChannel !== undefined) parts.push(`applying via ${APPLICATION_CHANNEL_LABELS[filter.applicationChannel]}`);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

const EXPERIENCE_BUCKETS: readonly ExperienceBucket[] = ["0-1", "1-3", "3-5", "5-8", "8+"];
const APPLICATION_CHANNELS: readonly ApplicationChannel[] = ["referral", "recruiter_outreach", "job_board", "company_website", "other"];

/** Narrow an arbitrary query-param string to a valid bucket, or undefined. Never throws on garbage input — a malformed URL just falls back to "everyone". */
export function parseExperienceBucket(value: string | undefined): ExperienceBucket | undefined {
  return value !== undefined && (EXPERIENCE_BUCKETS as readonly string[]).includes(value) ? (value as ExperienceBucket) : undefined;
}

export function parseApplicationChannel(value: string | undefined): ApplicationChannel | undefined {
  return value !== undefined && (APPLICATION_CHANNELS as readonly string[]).includes(value) ? (value as ApplicationChannel) : undefined;
}
