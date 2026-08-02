/**
 * Similar-companies ranking — the pure ordering rule behind "Companies like
 * this one". The DB assembly (loadSimilarCompanies) is exercised by live
 * verification; this pins the rule that decides who ranks above whom, and the
 * honesty guarantee that a company sharing nothing is never surfaced.
 */

import { describe, expect, it } from "vitest";
import { rankSimilarCompanies } from "@/lib/company-intelligence/similar";

const cand = (slug: string, displayName: string, sharedTerms: string[]) => ({
  organizationId: `org-${slug}`,
  slug,
  displayName,
  sharedTerms,
});

describe("rankSimilarCompanies", () => {
  it("orders by number of shared terms, most first", () => {
    const ranked = rankSimilarCompanies(
      [
        cand("a", "Alpha", ["Fintech"]),
        cand("b", "Beta", ["Fintech", "Payments", "SaaS"]),
        cand("c", "Gamma", ["Fintech", "Payments"]),
      ],
      6
    );
    expect(ranked.map((r) => r.slug)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties alphabetically by display name for a stable order", () => {
    const ranked = rankSimilarCompanies(
      [
        cand("z", "Zeta", ["X", "Y"]),
        cand("d", "Delta", ["X", "Y"]),
        cand("m", "Mu", ["X", "Y"]),
      ],
      6
    );
    expect(ranked.map((r) => r.displayName)).toEqual(["Delta", "Mu", "Zeta"]);
  });

  it("drops candidates that share nothing — never surfaces a non-match", () => {
    const ranked = rankSimilarCompanies(
      [cand("a", "Alpha", []), cand("b", "Beta", ["Fintech"])],
      6
    );
    expect(ranked.map((r) => r.slug)).toEqual(["b"]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => cand(`c${i}`, `Company ${i}`, ["Shared"]));
    expect(rankSimilarCompanies(many, 3)).toHaveLength(3);
  });

  it("returns an empty list for no candidates", () => {
    expect(rankSimilarCompanies([], 6)).toEqual([]);
  });

  it("carries the shared-term labels through for the 'why'", () => {
    const [top] = rankSimilarCompanies([cand("b", "Beta", ["Fintech", "Payments"])], 6);
    expect(top.sharedTerms).toEqual(["Fintech", "Payments"]);
  });
});
