/**
 * Per-source weighted-share cap (ADR-0002 Part 8 + self-critique #3).
 *
 * The engine does no cross-family dedup in v1, which means one loud external
 * source — "one viral Reddit thread" — could, once adapters scale, contribute
 * enough near-duplicate reports to dominate a company's evidence. This is the
 * backstop: no single EXTERNAL source may carry more than `maxShare` of a
 * company's total evidence weight. First-party is never capped — it is the
 * reference standard, not a source we defend against.
 *
 * PURE. Runs inside loadEvidence so every surface (company page, rankings)
 * sees the same capped weights — a company cannot show one HQS on its page
 * and a different one in a leaderboard.
 *
 * Composition with sunset: at globalMultiplier = 0 every external weight is
 * already 0, so no source exceeds any cap and this is a no-op — the sunset
 * invariant is preserved for free.
 */

import type { EvidenceItem } from "./types";

/** No single external source may exceed 50% of a company's total evidence
 *  weight. At 50%, one source can at most equal everything else combined. */
export const DEFAULT_MAX_SOURCE_SHARE = 0.5;

/**
 * Scale down any external source whose weighted share exceeds `maxShare`.
 * Returns a NEW array (never mutates inputs); items whose weight is unchanged
 * are returned as-is, capped items get a reduced `weight`.
 *
 * The cap is defined against the FINAL total: for a source with weight `s` and
 * everything-else `others`, we need s'/(s' + others) ≤ maxShare, so the target
 * is `maxShare · others / (1 − maxShare)`. Sources are processed in a
 * deterministic key order and `others` reflects already-capped weights, so the
 * result is stable and independent of input ordering.
 *
 * `others === 0` (a company with only one source of any weight) is deliberately
 * NOT capped: there is nothing for that source to drown out, and zeroing the
 * only evidence a company has would be worse than the skew the cap prevents.
 * The Evidence Mix UI already discloses a single-source company honestly.
 */
export function capSourceShare(items: EvidenceItem[], maxShare: number = DEFAULT_MAX_SOURCE_SHARE): EvidenceItem[] {
  if (maxShare <= 0 || maxShare >= 1) return items; // a meaningless cap is a no-op, not a divide-by-zero
  if (items.length === 0) return items;

  // Only external sources are cap targets. Group their indices by sourceKey.
  const externalBySource = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    if (items[i].family !== "external") continue;
    const key = items[i].sourceKey;
    const list = externalBySource.get(key);
    if (list) list.push(i);
    else externalBySource.set(key, [i]);
  }
  if (externalBySource.size === 0) return items; // nothing external to cap

  // Work on a mutable copy of weights; only touch what we actually scale.
  const weights = items.map((i) => i.weight);
  const ratio = maxShare / (1 - maxShare);
  let anyChanged = false;

  for (const sourceKey of [...externalBySource.keys()].sort()) {
    const indices = externalBySource.get(sourceKey)!;
    const sourceWeight = indices.reduce((s, idx) => s + weights[idx], 0);
    if (sourceWeight <= 0) continue;

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const others = totalWeight - sourceWeight;
    if (others <= 0) continue; // single-source company — nothing to protect

    const target = ratio * others;
    if (sourceWeight <= target) continue; // already within the cap

    const scale = target / sourceWeight;
    for (const idx of indices) weights[idx] = weights[idx] * scale;
    anyChanged = true;
  }

  if (!anyChanged) return items;
  return items.map((item, i) => (weights[i] === item.weight ? item : { ...item, weight: weights[i] }));
}
