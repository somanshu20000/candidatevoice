/**
 * Human labels for the stored enum values.
 *
 * Every field a candidate submits is a closed enum (see the CHECK constraints in
 * supabase/migrations/0000_baseline_hiring_submissions.sql and the server
 * allowlists in src/app/api/submit/route.ts). The database therefore stores
 * `experience_mismatch`, not "Experience mismatch".
 *
 * Until now the human labels existed only as <option> text inside
 * src/app/submit/page.tsx, so the read path had nothing to map through and the
 * home feed, browse grid and admin queue all rendered the raw token — a card
 * whose body literally read "no_reason". This module is the shared source of
 * truth for turning a stored value into something a person can read.
 *
 * Unknown values fall back to a de-underscored, sentence-cased form rather than
 * throwing or rendering blank, so a value added to the database before this file
 * is updated still degrades to something legible.
 */

const REASON_LABELS: Record<string, string> = {
  experience_mismatch: "Experience mismatch",
  skill_mismatch: "Skill mismatch",
  culture_fit: "Culture fit",
  no_reason: "No reason given",
  other: "Other",
};

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  technical: "Technical",
  hr: "HR",
  final: "Final round",
};

const OUTCOME_LABELS: Record<string, string> = {
  rejected: "Rejected",
  no_response: "No response",
  offer: "Offer",
  ongoing: "Ongoing",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  "0-1": "0–1 years",
  "1-3": "1–3 years",
  "3-5": "3–5 years",
  "5-8": "5–8 years",
  "8+": "8+ years",
};

/** Last-resort readable form: "some_value" -> "Some value". */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (spaced.length === 0) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function lookup(table: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "";
  return table[value] ?? humanize(value);
}

export function reasonLabel(value: string | null | undefined): string {
  return lookup(REASON_LABELS, value);
}

export function stageLabel(value: string | null | undefined): string {
  return lookup(STAGE_LABELS, value);
}

export function outcomeLabel(value: string | null | undefined): string {
  return lookup(OUTCOME_LABELS, value);
}

export function experienceLabel(value: string | null | undefined): string {
  return lookup(EXPERIENCE_LABELS, value);
}

/**
 * The one-line summary shown on a submission card.
 *
 * `reason` is a five-value enum, never prose — there is no free-text narrative
 * field in this product by design (see docs/adr-0001-evidence-model.md §1.5).
 * So this phrases the enum as a short factual sentence instead of presenting a
 * bare token as if the candidate had written it.
 */
export function reasonSummary(reason: string | null | undefined): string {
  if (!reason) return "No reason recorded.";
  if (reason === "no_reason") return "No reason was given.";
  if (reason === "other") return "Reason given: other.";
  return `Reason given: ${reasonLabel(reason).toLowerCase()}.`;
}
