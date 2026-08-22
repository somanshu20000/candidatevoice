/**
 * Generic acquisition parser tests (Task 3 req 12). Runs against the
 * deterministic local fixture (tests/fixtures/generic-review-page.html) —
 * NO network, NO browser. Proves the parser: finds every card, extracts
 * fields, flags partial records, tolerates malformed HTML without throwing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseReviewPage, type ReviewSelectors } from "@/lib/external-intel/generic/parser";

const FIXTURE = readFileSync(
  path.join(process.cwd(), "tests/fixtures/generic-review-page.html"),
  "utf8"
);

const SELECTORS: ReviewSelectors = {
  card: "li.review-card",
  company: ".company",
  role: ".role",
  outcome: ".outcome",
  stage: ".stage",
  experience: ".experience",
  responseTime: ".response-time",
  lastGap: ".last-gap",
  reason: ".reason",
  reportedDate: ".reported-date",
  externalRefAttr: "data-review-id",
};

describe("parseReviewPage", () => {
  const result = parseReviewPage(FIXTURE, SELECTORS);

  it("finds every review card, including the messy one", () => {
    expect(result.cardsFound).toBe(7);
    expect(result.records).toHaveLength(7);
  });

  it("extracts a clean card's fields and its external ref", () => {
    const clean = result.records[0];
    expect(clean.company).toBe("Verdant Softworks");
    expect(clean.role).toBe("Software Engineer");
    expect(clean.outcome).toBe("Rejected");
    expect(clean.reason).toBe("skill_mismatch");
    expect(clean.externalRef).toBe("rv-1001");
    expect(clean.partial).toBe(false);
  });

  it("flags a company-less card as partial", () => {
    const missingCompany = result.records[1];
    expect(missingCompany.company).toBeNull();
    expect(missingCompany.partial).toBe(true);
    // other fields still parse — partial is about the company only
    expect(missingCompany.outcome).toBe("Offer");
  });

  it("returns nulls (not throws) for absent fields on a company-only card", () => {
    const companyOnly = result.records[2];
    expect(companyOnly.company).toBe("Presidio Cloud Systems");
    expect(companyOnly.outcome).toBeNull();
    expect(companyOnly.stage).toBeNull();
    expect(companyOnly.partial).toBe(false);
  });

  it("normalizes messy markup (uppercase tags, &nbsp;, stray whitespace)", () => {
    // Card 7 uses <LI>/<SPAN>, an &nbsp;, and multiple internal spaces —
    // the parser must fold it into a clean value or downstream mapping fails.
    const messy = result.records[6];
    expect(messy.company).toBe("Meridian Media Networks");
    expect(messy.outcome).toBe("OFFER"); // case-folding to the enum is the extractor's job
    expect(messy.partial).toBe(false);
  });

  it("returns empty for HTML with no matching cards, never throws", () => {
    expect(parseReviewPage("<html><body><p>nothing here</p></body></html>", SELECTORS)).toEqual({
      records: [],
      cardsFound: 0,
    });
    expect(parseReviewPage("", SELECTORS).cardsFound).toBe(0);
  });
});
