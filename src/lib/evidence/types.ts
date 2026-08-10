/**
 * The Unified Evidence Engine — canonical types.
 *
 * See docs/adr-0002-evidence-engine.md. This module treats first-party
 * submissions and approved external reports as ONE stream of weighted
 * evidence items. It knows nothing about "Reddit" or "ghosting" —
 * product-specific meaning is assigned entirely by callers
 * (src/lib/fingerprint, src/utils/hqs.ts, analytics), which express every
 * metric as a predicate pair over the primitives in aggregate.ts. Nothing in
 * this directory computes a named business metric.
 *
 * THE FOUR CONFIDENCE VOCABULARIES ALREADY IN THIS CODEBASE (metadata
 * confidence, fingerprint confidence, extraction_confidence, trust_weight) are
 * a real source of cognitive load (ADR-0002 W3). This engine adds exactly ONE
 * more concept — EvidenceBase — and it is DERIVED, not invented: every field on
 * it is computed from the evidence itself. No caller should ever need a
 * confidence value this module cannot already produce.
 */

import type {
  HiringStage,
  HiringOutcome,
  ExperienceBucket,
  ResponseTimeBucket,
  LastInteractionGap,
  CallDuration,
  FirstInteractionOutcome,
  ApplicationChannel,
  SalaryHistoryStage,
  SalaryProofType,
  SalaryProofStage,
  SalaryRangeDisclosed,
  ReporterType,
  ExitExperienceLetter,
  ExitSettlement,
  ExitDocumentation,
  WouldRecommend,
  TenureBucket,
  ConductEnvironment,
} from "@/types/index";

export type EvidenceFamily = "first_party" | "external";

/**
 * One piece of evidence, first-party or external, already carrying its
 * effective weight. This is the ONLY shape every downstream consumer sees —
 * a metric never branches on `family` to decide whether something counts; it
 * counts by however much `weight` says it does.
 */
export interface EvidenceItem {
  id: string;
  family: EvidenceFamily;
  /** "candidatevoice" for first-party, else the contributing external_sources.key. */
  sourceKey: string;
  organizationId: string;
  /** Effective weight — first-party is always 1.0; external is the four-factor
   *  product from src/lib/hiring-intel/weighting.ts. Never recomputed here. */
  weight: number;
  /** YYYY-MM. The one granularity BOTH families share (ADR-0002 W2) — never a
   *  raw timestamp; public_submissions already coarsens first-party to this. */
  reportedMonth: string | null;

  /**
   * Reporter relationship (migration 0020). Present in both families, but
   * external is always 'candidate' (a forum post is interview-context). This is
   * the field the tenure dimensions filter on so an employee's culture answer
   * never lands in an interview metric and vice versa.
   */
  reporterType: ReporterType;

  // Present in BOTH families.
  stage: HiringStage | null;
  outcome: HiringOutcome | null;
  experienceBucket: ExperienceBucket | null;
  responseTimeBucket: ResponseTimeBucket | null;
  lastInteractionGap: LastInteractionGap | null;
  reason: string | null;
  paymentFlag: boolean | null;

  /**
   * FIRST-PARTY ONLY — always null for external evidence, because
   * external_reports has no equivalent columns (ADR-0002 W1: this is exactly
   * why Early Rejection cannot be a cross-family metric). Any metric reading
   * these must expect reduced `coverage` and must never be blended into a
   * headline number without disclosing that asymmetry.
   */
  callDuration: CallDuration | null;
  firstInteractionOutcome: FirstInteractionOutcome | null;
  /** How the candidate applied (migration 0014). Same asymmetry as the two
   *  fields above: external_reports has no equivalent column. The basis of
   *  cohort filtering in evidence/cohort.ts. */
  applicationChannel: ApplicationChannel | null;
  /** Compensation transparency & privacy (migration 0018). Same first-party
   *  asymmetry again. null means the candidate did not answer and the item is
   *  excluded from that metric — it is NOT the same as the explicit "never" /
   *  "none" values, which are answers. Silence must never become evidence. */
  salaryHistoryStage: SalaryHistoryStage | null;
  salaryProofType: SalaryProofType | null;
  salaryProofStage: SalaryProofStage | null;
  salaryRangeDisclosed: SalaryRangeDisclosed | null;
  /** Tenure-stage practices (migration 0020). Same first-party asymmetry: an
   *  external forum post has no equivalent columns, so these are always null on
   *  external. null = did not answer (excluded), never "no"; "na"/"none" are
   *  answers. The offboarding/culture/conduct engines read these. */
  exitExperienceLetter: ExitExperienceLetter | null;
  exitSettlement: ExitSettlement | null;
  exitDocumentation: ExitDocumentation | null;
  wouldRecommend: WouldRecommend | null;
  tenureBucket: TenureBucket | null;
  conductEnvironment: ConductEnvironment | null;

  /** External only; null for first-party (which has no extraction step). */
  extractionConfidence: number | null;
}

/**
 * Confidence, DERIVED — not invented. Every field is computed from the
 * evidence itself; nothing here is a separate score a caller must trust
 * blindly. `effectiveN` (Kish effective sample size) is the basis of every
 * suppression decision downstream — see aggregate.ts.
 */
export interface EvidenceBase {
  rawTotal: number;
  weightedTotal: number;
  firstPartyRaw: number;
  firstPartyWeighted: number;
  externalRaw: number;
  externalWeighted: number;
  /** By WEIGHT, not raw count — the honest measure of who is actually speaking. */
  firstPartyProportion: number;
  /** Distinct contributing sourceKeys. 1 means single-source risk. */
  sourceDiversity: number;
  monthsSpanned: number;
  earliestMonth: string | null;
  latestMonth: string | null;
  /** Kish effective sample size: (Σw)² / Σw². See aggregate.ts kishEffectiveN. */
  effectiveN: number;
}

export interface EvidenceSet {
  /** The canonical organization this set represents — the value the slug
   *  resolved to at load time. Exposed at the top level so a caller that
   *  needs to fetch related data (external-report display rows, company
   *  metadata) doesn't have to resolve the slug a second time or reach into
   *  items[0]?.organizationId (which is undefined when items is empty). */
  organizationId: string;
  items: EvidenceItem[];
  base: EvidenceBase;
  /** The global bootstrap multiplier in force when this set was built — for
   *  audit/debug, and so a caller can render "at policy X" without a second query. */
  globalMultiplier: number;
}

/**
 * Every metric returns BOTH raw and weighted, always (explicit product
 * decision — debugging, moderator tooling, confidence, future statistics).
 * `value` is the weighted result; `null` means suppressed, never a fabricated
 * number standing in for missing data.
 */
export interface MetricResult {
  value: number | null;
  weightedNumerator: number;
  weightedDenominator: number;
  rawNumerator: number;
  rawDenominator: number;
  /** Share of ALL items (not just eligible ones) that had the fields this
   *  metric needs — surfaces field asymmetry (W1) instead of hiding it. */
  coverage: number;
  suppressed: boolean;
  /** "no_coverage": zero eligible evidence, or eligible evidence carries zero
   *  total weight (e.g. sunset with only external data). "insufficient_evidence":
   *  evidence exists and carries weight, just not enough of it (effectiveN gate). */
  suppressionReason?: "no_coverage" | "insufficient_evidence";
}
