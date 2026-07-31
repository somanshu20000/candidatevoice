/**
 * The policy-driven weighting engine.
 *
 * Every piece of evidence — a first-party CandidateVoice submission OR an
 * approved external report — carries a single scalar WEIGHT, and the fingerprint
 * / HQS / analytics consume weighted evidence without caring where it came from.
 * This module computes that weight, and only that. It is pure and has no I/O, so
 * the trust-critical arithmetic is unit-testable in isolation.
 *
 * The formula, kept as four INDEPENDENT factors so each is understandable and
 * tunable on its own:
 *
 *   effective_weight =
 *       Source Trust            (per source:  external_sources.trust_weight)
 *     × Extraction Confidence   (per report:  external_reports.extraction_confidence)
 *     × Moderator Confidence    (per report:  derived from verification_status)
 *     × Global Bootstrap Multiplier (one platform policy value: platform_settings)
 *
 * A first-party submission does not pass through ANY of these discounts — it is
 * the reference, weight 1.0. External evidence is discounted toward it.
 *
 * THE SUNSET PROPERTY. Because the global multiplier is one factor in a product,
 * setting it to 0 drives every external weight to exactly 0 — the product
 * becomes first-party-only with no code, schema, or query change. That is not a
 * special case bolted on; it falls out of the multiplication.
 */

/** First-party evidence is the reference standard: full weight, no discount. */
export const FIRST_PARTY_WEIGHT = 1;

/**
 * When an adapter does not self-report an extraction confidence, we neither
 * trust it fully (1.0 — as if the extraction were certain) nor discard it
 * (0 — as if it failed). Half is the honest "unknown quality" middle. The
 * built-in reddit adapter always reports a confidence, so this only applies to
 * a future adapter that omits it.
 */
export const DEFAULT_EXTRACTION_CONFIDENCE = 0.5;

/**
 * Fail-safe global multiplier used when the platform_settings value is missing,
 * malformed, or unreadable. It is 0 — NOT the launch default — on purpose:
 * external evidence must influence the product only when an explicit, valid
 * policy says so. An outage or a deleted setting collapses safely to
 * first-party-only, never to "external counts by accident".
 */
export const FAILSAFE_GLOBAL_MULTIPLIER = 0;

export type VerificationStatus = "pending" | "approved" | "rejected" | "archived";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Moderator Confidence term. Today it is binary — only an approved report
 * counts, everything else contributes nothing — which is exactly the trust
 * boundary: nothing influences the product until a human approves it. Later
 * this can grow richer (moderator override, multi-reviewer corroboration,
 * first-party cross-confirmation) WITHOUT changing the aggregation engine,
 * because it is isolated behind this one function.
 */
export function moderatorConfidence(status: VerificationStatus): number {
  return status === "approved" ? 1 : 0;
}

/** Normalize a settings value into a usable multiplier, or the fail-safe. */
export function normalizeGlobalMultiplier(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return FAILSAFE_GLOBAL_MULTIPLIER;
  return clamp01(n);
}

export interface ExternalWeightInputs {
  /** Per-source reliability, external_sources.trust_weight (0..1). */
  sourceTrust: number;
  /** Per-report extraction confidence (0..1), or null when the adapter omitted it. */
  extractionConfidence: number | null;
  /** Moderation state — only 'approved' contributes. */
  status: VerificationStatus;
  /** The single platform policy value (0..1). */
  globalMultiplier: number;
}

/**
 * Effective weight of ONE external report. Each factor is clamped to [0,1], so
 * the product can never exceed 1 — an external report can approach, but never
 * outweigh, a first-party submission. A non-approved report, a source trust of
 * 0, or a global multiplier of 0 each independently zero it out.
 */
export function externalEvidenceWeight(inputs: ExternalWeightInputs): number {
  const trust = clamp01(inputs.sourceTrust);
  const extraction = clamp01(inputs.extractionConfidence ?? DEFAULT_EXTRACTION_CONFIDENCE);
  const moderator = moderatorConfidence(inputs.status);
  const global = clamp01(inputs.globalMultiplier);
  return trust * extraction * moderator * global;
}
