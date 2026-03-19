import type { HiringSubmission } from "@/types/index";

export function calculateHQS(data: HiringSubmission[]) {
  if (!data || data.length === 0) return null;
  const total = data.length;

  // Ghost rate — no response after 15+ days
  const ghostRate = data.filter(
    d => d.outcome === 'no_response' &&
    ['15-30', '30+'].includes(d.last_interaction_gap)
  ).length / total;

  // Early rejection rate
  const earlyRejectRate = data.filter(
    d => ['<2', '2-5'].includes(d.call_duration || '') &&
    d.first_interaction_outcome === 'rejected_immediately'
  ).length / total;

  // Transparency score
  const transparencyRate = data.filter(
    d => d.reason && d.reason !== 'no_reason'
  ).length / total;

  // Payment risk
  const paymentRate = data.filter(
    d => d.payment_flag !== 'no' && d.payment_flag != null
  ).length / total;

  // Response speed score (0-100)
  const responseMap: Record<string, number> = {
    '0-3': 100, '4-7': 80, '8-14': 50, '15+': 20
  };
  const responseScore = data.reduce(
    (acc, d) => acc + (responseMap[d.response_time_bucket] || 50), 0
  ) / total;

  // HQS formula
  const hqs = Math.round(
    0.30 * responseScore +
    0.25 * ((1 - earlyRejectRate) * 100) +
    0.25 * (transparencyRate * 100) +
    0.20 * ((1 - ghostRate) * 100)
  );

  return {
    hqs,
    ghostRate: Math.round(ghostRate * 100),
    earlyRejectRate: Math.round(earlyRejectRate * 100),
    transparencyRate: Math.round(transparencyRate * 100),
    paymentRate: Math.round(paymentRate * 100),
    responseScore: Math.round(responseScore),
    total,
    confidence: total >= 50 ? 'high' : total >= 20 ? 'medium' : 'low'
  };
}
