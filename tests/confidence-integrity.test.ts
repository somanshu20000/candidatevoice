/**
 * "Generated → Verified" must be a one-way ratchet. A confidence write can
 * raise a row's confidence, never lower it — otherwise an on-demand re-enrich
 * (always `unverified`, by design) run against a row a prior CLI import had
 * already brought to `official` would silently discard real verification work.
 *
 * Pure-function tests only: upgradedConfidence/confidenceRank have no I/O, so
 * this is the layer that gets a fast unit test. The Supabase-specific wiring
 * (read-existing-row-before-upsert in store.ts) is exercised by live
 * verification (D1), matching how every other pure/I-O split in this codebase
 * is tested — see tests/evidence-engine.test.ts vs. load.ts, for instance.
 */

import { describe, expect, it } from "vitest";
import { confidenceRank, METADATA_CONFIDENCE_VALUES, type MetadataConfidence } from "@/lib/company-intelligence/types";
import { upgradedConfidence } from "@/lib/company-intelligence/store";

describe("confidenceRank", () => {
  it("orders the four labels low to high, matching METADATA_CONFIDENCE_VALUES", () => {
    expect(confidenceRank("unverified")).toBe(0);
    expect(confidenceRank("reported")).toBe(1);
    expect(confidenceRank("cross_checked")).toBe(2);
    expect(confidenceRank("official")).toBe(3);
  });

  it("is strictly increasing across the full ladder", () => {
    const ranks = METADATA_CONFIDENCE_VALUES.map(confidenceRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });
});

describe("upgradedConfidence — the one-way ratchet", () => {
  it("takes the new value when there is no prior row (a genuinely new write)", () => {
    expect(upgradedConfidence("unverified", null)).toBe("unverified");
    expect(upgradedConfidence("official", undefined)).toBe("official");
  });

  it("upgrades: a higher-trust write raises a lower-confidence row", () => {
    expect(upgradedConfidence("official", "unverified")).toBe("official");
    expect(upgradedConfidence("cross_checked", "reported")).toBe("cross_checked");
  });

  it("refuses to downgrade: a lower-trust write cannot lower a higher-confidence row", () => {
    // The exact regression this exists to prevent: an on-demand re-enrich
    // (always 'unverified') must not be able to demote an already-verified row.
    expect(upgradedConfidence("unverified", "official")).toBe("official");
    expect(upgradedConfidence("reported", "cross_checked")).toBe("cross_checked");
  });

  it("is a no-op when the new value equals the existing one", () => {
    for (const c of METADATA_CONFIDENCE_VALUES) {
      expect(upgradedConfidence(c, c)).toBe(c);
    }
  });

  it("never regresses across every pair of the ladder — exhaustive", () => {
    for (const prev of METADATA_CONFIDENCE_VALUES) {
      for (const next of METADATA_CONFIDENCE_VALUES) {
        const result = upgradedConfidence(next, prev);
        expect(confidenceRank(result)).toBeGreaterThanOrEqual(confidenceRank(prev));
        expect(confidenceRank(result)).toBeGreaterThanOrEqual(confidenceRank(next));
      }
    }
  });

  it("the on-demand path's own confidence can never win against an already-verified row", () => {
    // enrich.ts's ON_DEMAND_CONFIDENCE is hardcoded to 'unverified' — assert the
    // ratchet holds specifically for that value against every other rung, so a
    // future change to either constant is caught here rather than live.
    const onDemand: MetadataConfidence = "unverified";
    for (const prev of METADATA_CONFIDENCE_VALUES) {
      if (prev === "unverified") continue;
      expect(upgradedConfidence(onDemand, prev)).toBe(prev);
    }
  });
});
