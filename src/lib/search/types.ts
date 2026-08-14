/**
 * M3 Search — result contract (M3 architecture plan §7).
 *
 * One shape for both search modes: entity lookup (a company name/alias/domain)
 * and signal discovery (a hiring-pattern phrase mapped onto an existing
 * fingerprint dimension via lexicon.ts). Every field here is either a literal
 * fact (a DB row, the user's own query token) or a value the Evidence/
 * Fingerprint machinery already computed — this module defines no metric, no
 * aggregate, and no suppression rule of its own (D-001: same machinery).
 *
 * Nothing here is wired to a route yet — that is M3.1+. M3.0 is the contract
 * only, so the shape is fixed before any retrieval code depends on it.
 */

import type { BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";
import type { CompensationDimensionKey } from "@/lib/fingerprint/compensation";
import type { OffboardingDimensionKey } from "@/lib/fingerprint/offboarding";
import type { EvidenceBase, EvidenceFamily } from "@/lib/evidence";

/**
 * Every dimension key the signal lexicon (lexicon.ts) is allowed to name.
 * Sourced from the three fingerprint modules that already own these keys —
 * never redeclared as string literals, so a key renamed/removed upstream
 * fails `tsc` here rather than silently going stale.
 */
export type SearchDimensionKey = BehaviouralDimensionKey | CompensationDimensionKey | OffboardingDimensionKey;

/**
 * A dimension's rendered result, normalized across the three fingerprint
 * families (behavioural/compensation/offboarding) into one shape search can
 * read uniformly. Every field is REUSED from whichever module computed the
 * dimension — score/base/suppressed come straight off that module's output,
 * never recomputed here (D-001). `families` is empty for the salary/exit
 * dimensions, which are first-party-only by construction.
 */
export interface SearchDimensionScoreView {
  key: SearchDimensionKey;
  label: string;
  score: number | null;
  base: EvidenceBase;
  suppressed: boolean;
  families: EvidenceFamily[];
}

/** Which end of a dimension's 0..100 "higher is better" axis a signal query
 *  points toward. E.g. "companies that ghost" wants LOW ghosting score. */
export type SignalDirection = "high" | "low";

export type SearchMode = "entity" | "signal";

/** Mirrors search_organizations_ranked's match_reason (migration 0022) plus
 *  the one reason that can only occur in signal mode. */
export type EntityMatchKind =
  | "exact_slug"
  | "alias"
  | "domain"
  | "normalized_name"
  | "similar_name"
  | "similar_alias";

/**
 * Presentation band (M3 §6, stage 3). Bands never interleave: a thin result
 * must never be positioned so it reads as strong. Mirrors the ranked/unranked
 * split analytics.ts already uses.
 */
export type EvidenceBand = "well_evidenced" | "limited" | "insufficient";

export interface SearchResultMatch {
  kind: EntityMatchKind | "signal";
  /** The user's token/phrase that produced this match, verbatim. */
  matchedTerm: string;
  /** Signal mode only — null in entity mode. */
  dimension: { key: SearchDimensionKey; label: string; direction: SignalDirection } | null;
  /** Entity mode only — the 0..1 score from search_organizations_ranked.
   *  Never blended with an evidence score (relevance and trust stay separate — §6). */
  entityScore: number | null;
}

export interface SearchResultEvidence {
  band: EvidenceBand;
  /** The queried dimension's own result, reused verbatim from whichever
   *  fingerprint module computed it — never recomputed for search. Null in
   *  entity mode, or when the query names no dimension. For a compound (AND)
   *  signal query this is the weakest-evidenced of the requested dimensions,
   *  matching how band/confidence/freshness are taken (signal.ts). */
  dimension: SearchDimensionScoreView | null;
  base: EvidenceBase;
  /** Composition — makes "external-heavy" visible rather than hidden. */
  families: EvidenceFamily[];
  /** null (never a stand-in 0 — D-002) when band is `insufficient`. */
  signalStrength: number | null;
  /** False when too few companies render this dimension for a peer comparison
   *  (population < SIGNAL_MIN_POPULATION): signalStrength is then a raw
   *  directional score, and the ordering must be labelled "not yet peer-
   *  calibrated" rather than implying a comparison that doesn't exist (M3 §6). */
  populationCalibrated: boolean;
  confidence: number;
  freshness: number;
}

export interface SearchResult {
  organizationId: string;
  slug: string;
  displayName: string;
  mode: SearchMode;
  match: SearchResultMatch;
  evidence: SearchResultEvidence;
  /** Templated from the fields above, never generated (D-006). */
  explanation: string;
}
