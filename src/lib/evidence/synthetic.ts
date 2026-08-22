/**
 * A minimal EvidenceItem for reductions that aren't over hiring_submissions /
 * external_reports rows directly — hiring-intent opportunities (analytics.ts),
 * facet ratings and emotion tags (fingerprint/likert.ts) — but still want to
 * flow through the SAME weightedRate/weightedMean/kishEffectiveN machinery
 * (D-001) rather than a parallel statistics layer.
 *
 * Every evidence-specific field is null; weight is always firstPartyWeight()
 * because everything that constructs one of these is first-party by
 * construction — a candidate-submitted row, never an external source.
 */

import type { EvidenceItem } from "./types";
import type { ReporterType } from "@/types/index";
import { firstPartyWeight } from "./weight";

export function minimalEvidenceItem(
  id: string,
  organizationId: string,
  reporterType: ReporterType = "candidate"
): EvidenceItem {
  return {
    id,
    family: "first_party",
    sourceKey: "candidatevoice",
    organizationId,
    weight: firstPartyWeight(),
    reportedMonth: null,
    reporterType,
    stage: null,
    outcome: null,
    experienceBucket: null,
    responseTimeBucket: null,
    lastInteractionGap: null,
    reason: null,
    paymentFlag: null,
    callDuration: null,
    firstInteractionOutcome: null,
    applicationChannel: null,
    salaryHistoryStage: null,
    salaryProofType: null,
    salaryProofStage: null,
    salaryRangeDisclosed: null,
    exitExperienceLetter: null,
    exitSettlement: null,
    exitDocumentation: null,
    wouldRecommend: null,
    tenureBucket: null,
    conductEnvironment: null,
    extractionConfidence: null,
    // These synthetic items model opportunities/ratings/emotions, not a
    // submission's provenance — 'unverified' is the only honest value, and it
    // is never a weight anyway (D-022).
    verificationTier: "unverified",
    // Same reasoning as verificationTier above: these model
    // opportunities/ratings/emotions, not a submission's recruitment-process
    // facts, so null is the only honest value.
    outreachQuality: null,
    sensitiveInfoRequested: null,
    sensitiveInfoStage: null,
    sensitiveInfoPurposeExplained: null,
    sensitiveInfoNecessaryPerceived: null,
    // Same reasoning as outreachQuality above: these model
    // opportunities/ratings/emotions, not a submission's hiring-channel facts.
    hiringChannel: null,
    paymentRequestedBy: null,
  };
}
