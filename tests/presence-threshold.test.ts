/**
 * Live presence — display threshold (Task: ">100 threshold", "exactly 100
 * threshold"). Pure, no I/O — the single source of truth for the cutoff.
 */
import { describe, expect, it } from "vitest";
import { PRESENCE_THRESHOLD, shouldShowPresence } from "@/lib/presence/threshold";

describe("shouldShowPresence", () => {
  it("is exactly 100", () => {
    expect(PRESENCE_THRESHOLD).toBe(100);
  });

  it("does NOT show at exactly 100 — the requirement is strictly '>100', not '>=100'", () => {
    expect(shouldShowPresence(100)).toBe(false);
  });

  it("shows at 101", () => {
    expect(shouldShowPresence(101)).toBe(true);
  });

  it("does not show below the threshold", () => {
    expect(shouldShowPresence(0)).toBe(false);
    expect(shouldShowPresence(1)).toBe(false);
    expect(shouldShowPresence(99)).toBe(false);
  });

  it("shows well above the threshold", () => {
    expect(shouldShowPresence(127)).toBe(true);
    expect(shouldShowPresence(100_000)).toBe(true);
  });
});
