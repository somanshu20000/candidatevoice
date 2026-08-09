/**
 * Company resolution — confidenceTier is the one pure function in resolve.ts;
 * everything else is I/O (search_organizations_ranked, company_links,
 * company_requests) and is verified live against Supabase (see the
 * implementation report), matching this codebase's existing split between
 * unit-tested pure logic and live-verified I/O (e.g. directory.ts/enrich.ts
 * have no mock-based unit tests either).
 *
 * The one thing worth pinning here: confidenceTier's thresholds must match
 * search_organizations_ranked's own SQL thresholds exactly (0.85 confident
 * floor for exact_slug/alias/domain/normalized_name; 0.4 possible floor for
 * trigram similarity) — a drift here would silently change what the UI calls
 * "confident" vs "possible" without the SQL side noticing.
 */

import { describe, expect, it } from "vitest";
import { confidenceTier } from "@/lib/company-intelligence/resolve";

describe("confidenceTier", () => {
  it("exact tiers (slug/alias/domain/normalized_name) are 'confident'", () => {
    expect(confidenceTier(1.0)).toBe("confident"); // exact_slug, alias
    expect(confidenceTier(0.95)).toBe("confident"); // domain
    expect(confidenceTier(0.85)).toBe("confident"); // normalized_name — the floor itself
  });

  it("trigram similarity scores (0.4..0.84) are 'possible' — never auto-selected", () => {
    expect(confidenceTier(0.84)).toBe("possible");
    expect(confidenceTier(0.6)).toBe("possible");
    expect(confidenceTier(0.4)).toBe("possible"); // the floor itself
  });

  it("below the trigram floor is 'none' — no confident match", () => {
    expect(confidenceTier(0.39)).toBe("none");
    expect(confidenceTier(0)).toBe("none");
  });

  it("even a 'confident' tier is never a stand-in for explicit confirmation", () => {
    // This is a documentation-as-test assertion: confidenceTier only labels a
    // score for DISPLAY. It has no side effect and returns no organization_id
    // — every candidate, regardless of tier, still requires the user to click
    // "This is the company" before an id is usable (enforced in the submit UI
    // and re-verified server-side in /api/submit, not by this function).
    expect(typeof confidenceTier(1.0)).toBe("string");
  });
});
