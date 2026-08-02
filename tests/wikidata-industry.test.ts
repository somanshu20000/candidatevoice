/**
 * wikidataRecordFromEntity — pure, no network. Covers the P452 industry
 * addition specifically: it must feed RawCompanyRecord.industry with the raw
 * label string and nothing else, so normalize.ts's existing collectTaxonomy
 * (already tested in tests/company-intelligence.test.ts, which asserts
 * `industry: "Financial Services"` → `{kind:"industry", key:"financial_services"}`)
 * picks it up completely unmodified. This is the seam, not the slugification —
 * that stays tested where it already is.
 */

import { describe, expect, it } from "vitest";
import { wikidataRecordFromEntity, type VerifiedCompanyEntity } from "@/lib/company-intelligence/adapters/wikidata";

function entity(binding: VerifiedCompanyEntity["binding"]): VerifiedCompanyEntity {
  return { qid: "Q1", binding, enwikiTitle: null };
}

describe("wikidataRecordFromEntity — industry (P452)", () => {
  it("sets record.industry from industryLabel when present", () => {
    const record = wikidataRecordFromEntity("Acme Corp", entity({ industryLabel: { value: "Software industry" } }));
    expect(record.industry).toBe("Software industry");
  });

  it("omits industry entirely when the property is absent — never a placeholder", () => {
    const record = wikidataRecordFromEntity("Acme Corp", entity({}));
    expect(record.industry).toBeUndefined();
    expect("industry" in record).toBe(false);
  });

  it("does not disturb any of the other four properties this adapter already extracts", () => {
    const record = wikidataRecordFromEntity(
      "Acme Corp",
      entity({
        website: { value: "https://acme.example" },
        githubHandle: { value: "acme" },
        ticker: { value: "ACME" },
        inception: { value: "2010-01-01T00:00:00Z" },
        industryLabel: { value: "Software industry" },
      })
    );
    expect(record.website).toBe("https://acme.example");
    expect(record.github_org).toBe("acme");
    expect(record.stock_symbol).toBe("ACME");
    expect(record.founded_year).toBe(2010);
    expect(record.industry).toBe("Software industry");
  });

  it("always carries the company name through unchanged", () => {
    const record = wikidataRecordFromEntity("Acme Corp", entity({ industryLabel: { value: "Retail" } }));
    expect(record.name).toBe("Acme Corp");
  });
});
