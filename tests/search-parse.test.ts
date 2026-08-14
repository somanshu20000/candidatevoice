/**
 * M3.3 — deterministic query parser (src/lib/search/parse.ts).
 *
 * Pins the intent routing and the three jobs (signal extraction, unsupported-
 * capability flagging, entity residual) against the exact example queries the
 * M3 brief names, plus the properties that keep it honest: longest-phrase-first
 * matching, plural tolerance, and never silently dropping an unsupported
 * constraint.
 */

import { describe, expect, it } from "vitest";
import { parseQuery } from "@/lib/search/parse";

describe("intent routing on the brief's example queries", () => {
  it("'Razorpay' -> entity", () => {
    const p = parseQuery("Razorpay");
    expect(p.intent).toBe("entity");
    expect(p.entityQuery).toBe("Razorpay");
    expect(p.signals).toHaveLength(0);
  });

  it("'Razorpy' (typo) -> entity, passed through untouched for the RPC's trigram matcher", () => {
    const p = parseQuery("Razorpy");
    expect(p.intent).toBe("entity");
    expect(p.entityQuery).toBe("Razorpy");
  });

  it("'Razorpay ghosting' -> mixed (entity + a dimension hint)", () => {
    const p = parseQuery("Razorpay ghosting");
    expect(p.intent).toBe("mixed");
    expect(p.entityTokens).toEqual(["razorpay"]);
    expect(p.signals.map((s) => s.dimensionKey)).toEqual(["ghosting"]);
    expect(p.signals[0].direction).toBe("low");
  });

  it("'companies that ghost after technical rounds' -> signal only", () => {
    const p = parseQuery("companies that ghost after technical rounds");
    expect(p.intent).toBe("signal");
    expect(p.entityTokens).toEqual([]);
    expect(p.signals.map((s) => s.dimensionKey)).toEqual(["ghosting"]);
  });

  it("'companies in Gurgaon with slow responses' -> signal + unsupported location, constraint NOT dropped", () => {
    const p = parseQuery("companies in Gurgaon with slow responses");
    expect(p.intent).toBe("signal");
    expect(p.signals.map((s) => s.dimensionKey)).toEqual(["response_speed"]);
    expect(p.signals[0].direction).toBe("low");
    // The location constraint is surfaced, never silently ignored.
    expect(p.unsupported.some((u) => u.capability === "location" && u.term === "gurgaon")).toBe(true);
  });
});

describe("matching properties", () => {
  it("longest-phrase-first: 'slow response' matches as one response_speed signal, not two unigrams", () => {
    const p = parseQuery("slow response");
    expect(p.signals).toHaveLength(1);
    expect(p.signals[0].dimensionKey).toBe("response_speed");
    expect(p.entityTokens).toEqual([]);
  });

  it("plural tolerance: 'many rounds' still matches the 'many rounds' process_depth phrase", () => {
    const p = parseQuery("many rounds");
    expect(p.signals.map((s) => s.dimensionKey)).toEqual(["process_depth"]);
    expect(p.signals[0].direction).toBe("high");
  });

  it("dedups repeated signals to one (dimensionKey, direction)", () => {
    // "ghost" and "ghosting" both map to ghosting/low.
    const p = parseQuery("ghost ghosting");
    expect(p.signals).toHaveLength(1);
  });

  it("two distinct signals both survive", () => {
    const p = parseQuery("ghosting and slow response");
    const keys = p.signals.map((s) => s.dimensionKey).sort();
    expect(keys).toEqual(["ghosting", "response_speed"]);
  });

  it("a compensation-transparency signal is recognised (not confused with a salary amount)", () => {
    const p = parseQuery("asks for bank statements");
    expect(p.signals.map((s) => s.dimensionKey)).toEqual(["document_privacy"]);
    expect(p.signals[0].direction).toBe("low");
    expect(p.unsupported).toHaveLength(0);
  });
});

describe("unsupported capability detection", () => {
  it("flags an absolute salary amount as compensation_amount", () => {
    const p = parseQuery("companies paying over 20 LPA");
    expect(p.unsupported.some((u) => u.capability === "compensation_amount")).toBe(true);
  });

  it("a bare city name is flagged as an unsupported location", () => {
    const p = parseQuery("Bengaluru companies");
    expect(p.unsupported.some((u) => u.capability === "location" && u.term === "bengaluru")).toBe(true);
  });

  it("does not flag 'in tech' as a location (no over-eager 'in <word>' heuristic)", () => {
    const p = parseQuery("tech companies");
    expect(p.unsupported).toHaveLength(0);
    expect(p.entityTokens).toEqual(["tech"]);
  });
});

describe("edge cases", () => {
  it("empty / whitespace / punctuation-only -> empty intent", () => {
    expect(parseQuery("").intent).toBe("empty");
    expect(parseQuery("   ").intent).toBe("empty");
    expect(parseQuery("%,()").intent).toBe("empty");
  });

  it("a pure stopword query -> empty (nothing actionable)", () => {
    const p = parseQuery("show me companies");
    expect(p.intent).toBe("empty");
  });

  it("a non-stopword residual is treated as an entity query, not discarded", () => {
    // "hire" is not filler, so "companies that hire" falls back to an entity
    // search on "hire" rather than being dropped — honest, not empty.
    const p = parseQuery("companies that hire");
    expect(p.intent).toBe("entity");
    expect(p.entityTokens).toEqual(["hire"]);
  });

  it("a domain-shaped entity query survives intact for the RPC domain matcher", () => {
    const p = parseQuery("razorpay.com");
    expect(p.intent).toBe("entity");
    expect(p.entityQuery).toBe("razorpay.com");
  });
});
