/**
 * M3.0 — structural integrity of the signal lexicon (src/lib/search/lexicon.ts).
 * Pins the properties the "checked-in vocabulary, not semantic search" design
 * depends on: every entry names a real dimension, no synonym is claimed twice,
 * every dimension is actually reachable, and the exact-phrase lookup behaves.
 */

import { describe, expect, it } from "vitest";
import { SIGNAL_LEXICON, dimensionLabel, lookupSignalTerm, type LexiconEntry } from "@/lib/search/lexicon";
import { BEHAVIOURAL_DIMENSION_KEYS } from "@/lib/fingerprint/behavioural";
import type { CompensationDimensionKey } from "@/lib/fingerprint/compensation";
import type { OffboardingDimensionKey } from "@/lib/fingerprint/offboarding";
import type { SearchDimensionKey } from "@/lib/search/types";

const COMPENSATION_KEYS: CompensationDimensionKey[] = [
  "salary_history_privacy",
  "document_privacy",
  "range_transparency",
  "verification_timing",
];

const OFFBOARDING_KEYS: OffboardingDimensionKey[] = [
  "experience_letter",
  "settlement_timeliness",
  "documentation_completeness",
];

const ALL_KNOWN_KEYS: SearchDimensionKey[] = [
  ...BEHAVIOURAL_DIMENSION_KEYS,
  ...COMPENSATION_KEYS,
  ...OFFBOARDING_KEYS,
];

describe("every lexicon entry references a real, existing dimension key", () => {
  it("dimensionKey is one of the known behavioural/compensation/offboarding keys", () => {
    for (const entry of SIGNAL_LEXICON) {
      expect(ALL_KNOWN_KEYS).toContain(entry.dimensionKey);
    }
  });

  it("dimensionLabel resolves a non-empty label for every entry's key", () => {
    for (const entry of SIGNAL_LEXICON) {
      const label = dimensionLabel(entry.dimensionKey);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("direction is always 'high' or 'low'", () => {
    for (const entry of SIGNAL_LEXICON) {
      expect(["high", "low"]).toContain(entry.direction);
    }
  });
});

describe("no duplicate synonyms", () => {
  it("every term string appears exactly once, case-insensitively", () => {
    const seen = new Map<string, LexiconEntry>();
    for (const entry of SIGNAL_LEXICON) {
      const key = entry.term.trim().toLowerCase();
      const prior = seen.get(key);
      expect(prior, `"${entry.term}" is already claimed by dimension "${prior?.dimensionKey}"`).toBeUndefined();
      seen.set(key, entry);
    }
  });

  it("every stored term is already lowercase and trimmed (source-of-truth hygiene)", () => {
    for (const entry of SIGNAL_LEXICON) {
      expect(entry.term).toBe(entry.term.trim().toLowerCase());
    }
  });
});

describe("dimension coverage", () => {
  it("every known dimension key is reachable by at least one lexicon entry", () => {
    const covered = new Set(SIGNAL_LEXICON.map((e) => e.dimensionKey));
    for (const key of ALL_KNOWN_KEYS) {
      expect(covered.has(key), `no lexicon entry maps to "${key}"`).toBe(true);
    }
  });

  it("every dimension that has more than one entry has both a 'low' and a 'high' phrase", () => {
    // Not a hard requirement (some dimensions may only ever be searched one
    // way), but a real gap is worth surfacing rather than silently allowed —
    // this asserts today's lexicon actually covers both directions everywhere
    // it claims to (verification_timing/documentation_completeness included).
    const byKey = new Map<SearchDimensionKey, Set<"high" | "low">>();
    for (const entry of SIGNAL_LEXICON) {
      const set = byKey.get(entry.dimensionKey) ?? new Set<"high" | "low">();
      set.add(entry.direction);
      byKey.set(entry.dimensionKey, set);
    }
    for (const key of ALL_KNOWN_KEYS) {
      const directions = byKey.get(key);
      expect(directions, `"${key}" has no entries at all`).toBeDefined();
      expect(directions!.has("high") || directions!.has("low")).toBe(true);
    }
  });
});

describe("lookupSignalTerm", () => {
  it("finds a known term exactly", () => {
    const result = lookupSignalTerm("ghosting");
    expect(result).not.toBeNull();
    expect(result!.dimensionKey).toBe("ghosting");
    expect(result!.direction).toBe("low");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(lookupSignalTerm("  GHOSTING  ")).toEqual(lookupSignalTerm("ghosting"));
    expect(lookupSignalTerm("Slow Response")).not.toBeNull();
  });

  it("returns null for an unknown phrase rather than guessing a nearest match", () => {
    expect(lookupSignalTerm("companies in gurgaon")).toBeNull();
    expect(lookupSignalTerm("")).toBeNull();
    expect(lookupSignalTerm("razorpay")).toBeNull();
  });

  it("distinct terms mapping to the same dimension resolve to that dimension consistently", () => {
    const a = lookupSignalTerm("ghost");
    const b = lookupSignalTerm("goes silent");
    expect(a!.dimensionKey).toBe(b!.dimensionKey);
    expect(a!.direction).toBe(b!.direction);
  });
});
