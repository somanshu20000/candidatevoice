/**
 * M3.1 — entity search (src/lib/company-intelligence/directory.ts).
 *
 * Three pure pieces are unit-tested directly here: sanitizeSubstringQuery
 * (metacharacter stripping), mergeRankedAndSubstring (ranking/dedup), and
 * resolveSearchOutcome (the outage-vs-empty decision). The two query passes
 * themselves (search_organizations_ranked via resolve.ts, and the .ilike
 * substring fallback) are I/O and — matching this codebase's established
 * split between unit-tested pure logic and live-verified I/O (directory.ts/
 * resolve.ts/logo-persistence.ts have no mock-based query tests either) — are
 * exercised live, not mocked here.
 *
 * Typo-tolerance and domain-matching themselves live entirely in
 * search_organizations_ranked's SQL (migration 0022, trigram similarity +
 * normalized_domain matching) — not reproducible from TS without a live DB.
 * What the "typo"/"domain" tests below pin is that the merge layer never
 * suppresses a ranked hit just because it has no substring-match counterpart,
 * which is the only way those RPC capabilities could be silently lost here.
 */

import { describe, expect, it } from "vitest";
import {
  mergeRankedAndSubstring,
  resolveSearchOutcome,
  sanitizeSubstringQuery,
  type CompanyListItem,
} from "@/lib/company-intelligence/directory";

function item(slug: string, displayName = slug): CompanyListItem {
  return { slug, displayName, description: null, foundedYear: null };
}

describe("sanitizeSubstringQuery", () => {
  it("strips PostgREST .or()-filter metacharacters", () => {
    expect(sanitizeSubstringQuery("Acme, Inc. (Pvt.)")).toBe("Acme Inc. Pvt.");
    expect(sanitizeSubstringQuery("100% Fintech*")).toBe("100 Fintech");
    expect(sanitizeSubstringQuery("back\\slash")).toBe("backslash");
  });

  it("trims surrounding whitespace after stripping", () => {
    expect(sanitizeSubstringQuery("  (Razorpay)  ")).toBe("Razorpay");
  });

  it("a query that is only metacharacters sanitizes to an empty string", () => {
    expect(sanitizeSubstringQuery("%,()*\\")).toBe("");
    expect(sanitizeSubstringQuery("   ")).toBe("");
  });

  it("an ordinary company name passes through unchanged", () => {
    expect(sanitizeSubstringQuery("Razorpay")).toBe("Razorpay");
    expect(sanitizeSubstringQuery("Kodehash Tech")).toBe("Kodehash Tech");
  });
});

describe("mergeRankedAndSubstring", () => {
  it("exact company name (ranked) outranks a substring-only match", () => {
    // Alphabetically "Acme" would sort before "Razorpay" in a naive merge —
    // but Razorpay is the RPC's exact-match hit for this query, so it must win.
    const ranked = [item("razorpay", "Razorpay")];
    const substring = [item("acme", "Acme"), item("razorpay", "Razorpay")];
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["razorpay", "acme"]);
  });

  it("a small typo — a ranked-only trigram hit — still surfaces with no substring counterpart", () => {
    // As if the user typed "Razorpy": .ilike '%Razorpy%' would not match
    // "Razorpay", so the substring pass returns nothing — only the RPC's
    // trigram similarity finds it. The merge must not require a substring
    // corroborator for a ranked hit.
    const ranked = [item("razorpay", "Razorpay")];
    const substring: CompanyListItem[] = [];
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["razorpay"]);
  });

  it("a domain/URL query — a ranked-only domain-match hit — still surfaces with no substring counterpart", () => {
    // As if the user pasted "razorpay.com": the RPC resolves it via
    // company_links.normalized_domain; display_name/slug .ilike would not
    // necessarily match a bare domain string.
    const ranked = [item("razorpay", "Razorpay")];
    const substring: CompanyListItem[] = [];
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["razorpay"]);
  });

  it("a company findable only by substring (below the RPC's trigram floor) still surfaces", () => {
    // The actual regression this milestone exists to avoid: a short mid-word
    // query like "tech" against "Kodehash Tech" scores well under
    // search_organizations_ranked's 0.4 trigram floor, so it would be
    // silently dropped if the substring pass were removed rather than layered.
    const ranked: CompanyListItem[] = [];
    const substring = [item("kodehash-tech", "Kodehash Tech")];
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["kodehash-tech"]);
  });

  it("a slug present in both lists (duplicate organization) appears exactly once, keeping the ranked entry", () => {
    const ranked = [item("razorpay", "Razorpay")];
    const substring = [item("razorpay", "Razorpay")];
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result).toHaveLength(1);
  });

  it("substring-only hits keep their own alphabetical order among themselves", () => {
    const ranked: CompanyListItem[] = [];
    const substring = [item("zerodha", "Zerodha"), item("acme", "Acme")];
    // searchCompaniesBySubstring already returns its results pre-sorted
    // alphabetically, so the merge must not re-sort them.
    const result = mergeRankedAndSubstring(ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["zerodha", "acme"]);
  });

  it("respects the limit, ranked hits taking priority", () => {
    const ranked = [item("a"), item("b")];
    const substring = [item("c"), item("d"), item("e")];
    const result = mergeRankedAndSubstring(ranked, substring, 3);
    expect(result.map((r) => r.slug)).toEqual(["a", "b", "c"]);
  });

  it("an empty query is safe — handles empty ranked and/or substring lists", () => {
    expect(mergeRankedAndSubstring([], [], 10)).toEqual([]);
    expect(mergeRankedAndSubstring([item("a")], [], 10).map((r) => r.slug)).toEqual(["a"]);
    expect(mergeRankedAndSubstring([], [item("a")], 10).map((r) => r.slug)).toEqual(["a"]);
  });
});

describe("resolveSearchOutcome", () => {
  it("returns the normal merge when neither pass failed", () => {
    const ranked = [item("razorpay")];
    const substring = [item("zoho")];
    const result = resolveSearchOutcome(false, false, ranked, substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["razorpay", "zoho"]);
  });

  it("degrades to substring-only results when only the ranked pass failed — does not throw", () => {
    const substring = [item("zoho")];
    const result = resolveSearchOutcome(true, false, [], substring, 10);
    expect(result.map((r) => r.slug)).toEqual(["zoho"]);
  });

  it("degrades to ranked-only results when only the substring pass failed — does not throw", () => {
    const ranked = [item("razorpay")];
    const result = resolveSearchOutcome(false, true, ranked, [], 10);
    expect(result.map((r) => r.slug)).toEqual(["razorpay"]);
  });

  it("throws — never returns [] — when BOTH passes failed, so an outage can't render as 'no companies found'", () => {
    expect(() => resolveSearchOutcome(true, true, [], [], 10)).toThrow(
      /both the ranked and substring search passes failed/
    );
  });

  it("a total failure with genuinely-empty (not failed) passes still returns an honest empty array", () => {
    // Distinguishes "both queries ran and found nothing" from "both queries failed".
    const result = resolveSearchOutcome(false, false, [], [], 10);
    expect(result).toEqual([]);
  });
});
