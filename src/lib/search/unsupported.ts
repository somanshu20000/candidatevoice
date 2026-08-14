/**
 * M3.3 — capabilities a user will plausibly ask for that CandidateVoice cannot
 * currently answer, so the parser can name them explicitly instead of silently
 * dropping the constraint (M3 §8 case I).
 *
 * Two capabilities today, both grounded in a real data fact, not a guess:
 *
 *   location — company_locations has 0 rows in production, so "companies in
 *     Gurgaon" is unanswerable. Detected via a curated list of major
 *     Indian-tech-hub city names (deterministic; no fuzzy geocoding, no LLM).
 *     The list is intentionally small and explicit — a heuristic like "in
 *     <any word>" would false-positive on "in tech".
 *
 *   compensation_amount — CandidateVoice records salary-transparency PRACTICES
 *     (was a range disclosed? were documents demanded?) but never an absolute
 *     figure, so "companies paying over 20 LPA" is unanswerable. Detected via a
 *     money regex (₹ / lakh / lpa / k + digits).
 *
 * This is NOT a lexicon of things we refuse — it is a lexicon of things we are
 * honest about not having yet. When company_locations is populated, the
 * location entries move to a real filter and leave here.
 */

export type UnsupportedCapability = "location" | "compensation_amount";

/**
 * City names that signal a location constraint. Lowercase, single-token or
 * multi-token. The parser matches these as phrases (longest first) exactly
 * like lexicon signals, so "bengaluru" and "new delhi" both resolve.
 */
export const LOCATION_TERMS: string[] = [
  "gurgaon",
  "gurugram",
  "bangalore",
  "bengaluru",
  "mumbai",
  "delhi",
  "new delhi",
  "noida",
  "pune",
  "hyderabad",
  "chennai",
  "kolkata",
  "ahmedabad",
  "ncr",
];

/** Human label for a capability, for the UI's "we don't support X yet" notice. */
export const CAPABILITY_LABELS: Record<UnsupportedCapability, string> = {
  location: "office location",
  compensation_amount: "specific salary amounts",
};

/**
 * Detect an absolute-compensation ask anywhere in the raw query. Returns the
 * matched fragment (for the explanation) or null. Deterministic regex, no
 * parsing of the amount itself — we only need to know the user asked.
 */
export function detectCompensationAmount(raw: string): string | null {
  const m = raw
    .toLowerCase()
    .match(/(₹\s?\d[\d,]*|(?:\d[\d.]*)\s?(?:lpa|lakhs?|lacs?|crores?|k\b))/);
  return m ? m[0].trim() : null;
}
