/**
 * Weight attachment — delegates ENTIRELY to src/lib/hiring-intel/weighting.ts.
 * The formula is not reimplemented here; that module is already pure and
 * has 11 passing unit tests covering the sunset property, clamping, and the
 * null-confidence default. This file only adapts its shape to EvidenceItem.
 */

import {
  FIRST_PARTY_WEIGHT,
  externalEvidenceWeight,
  type VerificationStatus,
} from "@/lib/hiring-intel/weighting";

/** First-party evidence is the reference standard — always full weight. */
export function firstPartyWeight(): number {
  return FIRST_PARTY_WEIGHT;
}

export interface ExternalWeightContext {
  sourceTrust: number;
  extractionConfidence: number | null;
  /** Always 'approved' in practice — load.ts only ever loads approved rows —
   *  but passed through explicitly rather than assumed, so a future loosening
   *  of that filter cannot silently mis-weight a non-approved row. */
  status: VerificationStatus;
  globalMultiplier: number;
}

export function externalWeight(ctx: ExternalWeightContext): number {
  return externalEvidenceWeight({
    sourceTrust: ctx.sourceTrust,
    extractionConfidence: ctx.extractionConfidence,
    status: ctx.status,
    globalMultiplier: ctx.globalMultiplier,
  });
}
