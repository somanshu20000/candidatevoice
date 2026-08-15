/**
 * M5.2a — regression guard for the "verification tier must NEVER affect
 * evidence weighting" rule (M5.2 architecture decision §9). firstPartyWeight()
 * takes no parameters today, which makes this trivially true by construction
 * — this test exists to catch a FUTURE change that threads a tier into it.
 */

import { describe, expect, it } from "vitest";
import { firstPartyWeight } from "@/lib/evidence/weight";
import { FIRST_PARTY_WEIGHT } from "@/lib/hiring-intel/weighting";
import { GRANTABLE_TIERS } from "@/lib/verification/token";

describe("firstPartyWeight — tier neutrality", () => {
  it("takes no arguments (a tier cannot be threaded into it)", () => {
    expect(firstPartyWeight.length).toBe(0);
  });

  it("always returns FIRST_PARTY_WEIGHT, regardless of any hypothetical tier", () => {
    // firstPartyWeight ignores whatever is passed to it — assert that
    // holds even if a caller someday (incorrectly) passes a tier argument.
    for (const tier of [...GRANTABLE_TIERS, "unverified"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((firstPartyWeight as any)(tier)).toBe(FIRST_PARTY_WEIGHT);
    }
    expect(firstPartyWeight()).toBe(FIRST_PARTY_WEIGHT);
  });
});
