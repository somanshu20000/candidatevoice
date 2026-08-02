/**
 * Canonical Organizational Fingerprint taxonomy.
 *
 * This file MIRRORS the seed data in
 * supabase/migrations/0004_fingerprint_model.sql. The database is the system of
 * record (it holds the foreign keys); this module exists so the form, the
 * aggregation engine and the UI can share one typed definition without a round
 * trip for what is effectively a constant.
 *
 * The two must not drift. tests/fingerprint-taxonomy.test.ts parses the
 * migration and asserts every key, label, anchor and ordering matches.
 */

export type DimensionKey =
  | "professionalism"
  | "candidate_experience"
  | "hiring_process"
  | "emotional_climate"
  | "leadership"
  | "work_culture";

export type FacetKey =
  // professionalism
  | "recruiter_professionalism"
  | "interviewer_preparedness"
  | "punctuality"
  | "negotiation_conduct"
  // candidate_experience
  | "respect"
  | "fairness"
  | "communication"
  | "feedback_quality"
  | "transparency"
  // hiring_process
  | "role_clarity"
  | "process_efficiency"
  | "assignment_reasonableness"
  | "technical_depth"
  | "compensation_clarity"
  | "work_arrangement_clarity";

export type EmotionKey =
  | "appreciated"
  | "respected"
  | "excited"
  | "motivated"
  | "confused"
  | "stressed"
  | "frustrated"
  | "ignored"
  | "angry"
  | "burned_out";

/** Who is able to witness a dimension at all. */
export type SourceType = "candidate" | "employee" | "both";

/** How a dimension is measured: rolled-up facet ratings, or an emotion distribution. */
export type Measurement = "likert" | "emotion";

export interface Dimension {
  key: DimensionKey;
  label: string;
  description: string;
  sourceType: SourceType;
  measurement: Measurement;
  displayOrder: number;
}

export interface Facet {
  key: FacetKey;
  dimensionKey: DimensionKey;
  label: string;
  prompt: string;
  /** What a rating of 1 means. Rendered on the form — an unlabelled scale aggregates nothing meaningful. */
  anchorLow: string;
  /** What a rating of 5 means. */
  anchorHigh: string;
  displayOrder: number;
}

export interface Emotion {
  key: EmotionKey;
  label: string;
  valence: "positive" | "negative";
  displayOrder: number;
}

export const DIMENSIONS: readonly Dimension[] = [
  {
    key: "professionalism",
    label: "Professionalism",
    description:
      "Conduct of the people running the process — recruiters, interviewers, and whoever handles the offer.",
    sourceType: "candidate",
    measurement: "likert",
    displayOrder: 1,
  },
  {
    key: "candidate_experience",
    label: "Candidate Experience",
    description:
      "How the process treated the person going through it: respect, fairness, communication and feedback.",
    sourceType: "candidate",
    measurement: "likert",
    displayOrder: 2,
  },
  {
    key: "hiring_process",
    label: "Hiring Process",
    description:
      "The structure of the process itself — clarity of the role, pacing, assignments and technical rigour.",
    sourceType: "candidate",
    measurement: "likert",
    displayOrder: 3,
  },
  {
    key: "emotional_climate",
    label: "Emotional Climate",
    description:
      "How candidates report feeling during and after the process, self-selected from a fixed vocabulary.",
    sourceType: "candidate",
    measurement: "emotion",
    displayOrder: 4,
  },
  // The two dimensions below have no collectable source today. Employee
  // reporting is deliberately out of scope: it is a different domain object
  // with a sharper re-identification and defamation profile than an anonymous
  // candidate report. They are declared so the fingerprint renders its full
  // shape and states honestly that the evidence does not exist yet, rather than
  // silently presenting a four-node model as if it were complete.
  {
    key: "leadership",
    label: "Leadership",
    description:
      "Manager behaviour, ownership, accountability and decision quality. Requires evidence from inside.",
    sourceType: "employee",
    measurement: "likert",
    displayOrder: 5,
  },
  {
    key: "work_culture",
    label: "Work Culture",
    description:
      "Collaboration, learning, bureaucracy, balance and psychological safety. Requires evidence from inside.",
    sourceType: "employee",
    measurement: "likert",
    displayOrder: 6,
  },
] as const;

export const FACETS: readonly Facet[] = [
  // Professionalism
  {
    key: "recruiter_professionalism",
    dimensionKey: "professionalism",
    label: "Recruiter conduct",
    prompt: "How did the recruiter conduct themselves?",
    anchorLow: "Unprofessional or misleading",
    anchorHigh: "Consistently professional",
    displayOrder: 1,
  },
  {
    key: "interviewer_preparedness",
    dimensionKey: "professionalism",
    label: "Interviewer preparation",
    prompt: "Were your interviewers prepared?",
    anchorLow: "Had not read anything",
    anchorHigh: "Well prepared",
    displayOrder: 2,
  },
  {
    key: "punctuality",
    dimensionKey: "professionalism",
    label: "Punctuality",
    prompt: "Did interviews happen when they were scheduled?",
    anchorLow: "Late, moved or no-showed",
    anchorHigh: "On time as scheduled",
    displayOrder: 3,
  },
  {
    key: "negotiation_conduct",
    dimensionKey: "professionalism",
    label: "Offer conduct",
    prompt: "How was the offer or salary discussion handled?",
    anchorLow: "Pressuring or evasive",
    anchorHigh: "Straightforward and clear",
    displayOrder: 4,
  },

  // Candidate Experience
  {
    key: "respect",
    dimensionKey: "candidate_experience",
    label: "Respect",
    prompt: "Were you treated with respect?",
    anchorLow: "Dismissive or rude",
    anchorHigh: "Consistently respectful",
    displayOrder: 1,
  },
  {
    key: "fairness",
    dimensionKey: "candidate_experience",
    label: "Fairness",
    prompt: "Was the evaluation fair and relevant to the role?",
    anchorLow: "Arbitrary or biased",
    anchorHigh: "Fair and job-relevant",
    displayOrder: 2,
  },
  {
    key: "communication",
    dimensionKey: "candidate_experience",
    label: "Communication",
    prompt: "How clear and timely was communication?",
    anchorLow: "Silence or confusion",
    anchorHigh: "Clear and prompt",
    displayOrder: 3,
  },
  {
    key: "feedback_quality",
    dimensionKey: "candidate_experience",
    label: "Feedback",
    prompt: "What was the quality of the feedback you received?",
    anchorLow: "None, or entirely generic",
    anchorHigh: "Specific and useful",
    displayOrder: 4,
  },
  {
    key: "transparency",
    dimensionKey: "candidate_experience",
    label: "Transparency",
    prompt: "How open were they about the role, process and pay?",
    anchorLow: "Withheld or misleading",
    anchorHigh: "Open and upfront",
    displayOrder: 5,
  },

  // Hiring Process
  {
    key: "role_clarity",
    dimensionKey: "hiring_process",
    label: "Role clarity",
    prompt: "Was the role clearly defined?",
    anchorLow: "Vague or kept shifting",
    anchorHigh: "Clearly defined throughout",
    displayOrder: 1,
  },
  {
    key: "process_efficiency",
    dimensionKey: "hiring_process",
    label: "Pacing",
    prompt: "Was the process an appropriate length for the role?",
    anchorLow: "Dragged out or stalled",
    anchorHigh: "Well paced",
    displayOrder: 2,
  },
  {
    key: "assignment_reasonableness",
    dimensionKey: "hiring_process",
    label: "Assignment scope",
    prompt: "If there was a take-home or assignment, was it reasonable?",
    anchorLow: "Excessive or unpaid real work",
    anchorHigh: "Reasonable in scope",
    displayOrder: 3,
  },
  {
    key: "technical_depth",
    dimensionKey: "hiring_process",
    label: "Technical rigour",
    prompt: "How relevant and rigorous was the technical evaluation?",
    anchorLow: "Superficial or irrelevant",
    anchorHigh: "Rigorous and relevant",
    displayOrder: 4,
  },
  // Two candidate-knowable clarity facets (migration 0017). A candidate learns
  // both DURING interviewing, so they are first-hand candidate evidence — unlike
  // salary satisfaction / WLB / growth, which require having worked at the
  // company and are deliberately out of scope (see the employee-sourced
  // leadership / work_culture dimensions).
  {
    key: "compensation_clarity",
    dimensionKey: "hiring_process",
    label: "Pay transparency",
    prompt: "Was the pay range disclosed during the process?",
    anchorLow: "Never disclosed or evasive",
    anchorHigh: "Disclosed early and clearly",
    displayOrder: 5,
  },
  {
    key: "work_arrangement_clarity",
    dimensionKey: "hiring_process",
    label: "Work arrangement",
    prompt: "Was the work arrangement (remote, hybrid or onsite) made clear?",
    anchorLow: "Vague or kept changing",
    anchorHigh: "Clear from the start",
    displayOrder: 6,
  },
] as const;

export const EMOTIONS: readonly Emotion[] = [
  { key: "appreciated", label: "Appreciated", valence: "positive", displayOrder: 1 },
  { key: "respected", label: "Respected", valence: "positive", displayOrder: 2 },
  { key: "excited", label: "Excited", valence: "positive", displayOrder: 3 },
  { key: "motivated", label: "Motivated", valence: "positive", displayOrder: 4 },
  { key: "confused", label: "Confused", valence: "negative", displayOrder: 5 },
  { key: "stressed", label: "Stressed", valence: "negative", displayOrder: 6 },
  { key: "frustrated", label: "Frustrated", valence: "negative", displayOrder: 7 },
  { key: "ignored", label: "Ignored", valence: "negative", displayOrder: 8 },
  { key: "angry", label: "Angry", valence: "negative", displayOrder: 9 },
  { key: "burned_out", label: "Burned out", valence: "negative", displayOrder: 10 },
] as const;

// --- Lookups -------------------------------------------------------------

export const DIMENSION_KEYS: readonly DimensionKey[] = DIMENSIONS.map((d) => d.key);
export const FACET_KEYS: readonly FacetKey[] = FACETS.map((f) => f.key);
export const EMOTION_KEYS: readonly EmotionKey[] = EMOTIONS.map((e) => e.key);

const DIMENSION_BY_KEY = new Map(DIMENSIONS.map((d) => [d.key, d]));
const FACET_BY_KEY = new Map(FACETS.map((f) => [f.key, f]));
const EMOTION_BY_KEY = new Map(EMOTIONS.map((e) => [e.key, e]));

export function getDimension(key: DimensionKey): Dimension | undefined {
  return DIMENSION_BY_KEY.get(key);
}

export function getFacet(key: FacetKey): Facet | undefined {
  return FACET_BY_KEY.get(key);
}

export function getEmotion(key: EmotionKey): Emotion | undefined {
  return EMOTION_BY_KEY.get(key);
}

export function facetsForDimension(key: DimensionKey): Facet[] {
  return FACETS.filter((f) => f.dimensionKey === key).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
}

/** Dimensions a candidate can actually supply evidence for — i.e. what the submit form asks about. */
export function collectableDimensions(): Dimension[] {
  return DIMENSIONS.filter(
    (d) => d.sourceType === "candidate" || d.sourceType === "both"
  ).sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Dimensions that exist in the model but have no evidence source enabled.
 * These render in the fingerprint as explicitly awaiting evidence rather than
 * as a zero score, which would misrepresent absence of data as a bad result.
 */
export function awaitingSourceDimensions(): Dimension[] {
  return DIMENSIONS.filter((d) => d.sourceType === "employee").sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
}

// --- Runtime guards (used by the API allowlist) ---------------------------

export function isFacetKey(value: unknown): value is FacetKey {
  return typeof value === "string" && FACET_BY_KEY.has(value as FacetKey);
}

export function isEmotionKey(value: unknown): value is EmotionKey {
  return typeof value === "string" && EMOTION_BY_KEY.has(value as EmotionKey);
}

export function isDimensionKey(value: unknown): value is DimensionKey {
  return typeof value === "string" && DIMENSION_BY_KEY.has(value as DimensionKey);
}

/** Valid Likert values. Matches the `rating between 1 and 5` CHECK in 0004. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}
