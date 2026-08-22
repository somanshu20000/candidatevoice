/**
 * Generic acquisition extractor tests (Task 3 req 12). Proves the mapping
 * from parsed strings to the EXISTING evidence contract: drops partial and
 * no-dimension records, dedups within a batch by content_hash, maps human
 * phrasings onto the closed enums (and drops unmappable ones), and emits
 * stable canonical content hashes + provenance. Pure — no network, no DB.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseReviewPage, type ReviewSelectors, type ParsedRecord } from "@/lib/external-intel/generic/parser";
import { extractReports, canonicalContentHash, GENERIC_EXTRACTOR_VERSION } from "@/lib/external-intel/generic/extract";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/generic-review-page.html"), "utf8");
const SELECTORS: ReviewSelectors = {
  card: "li.review-card", company: ".company", role: ".role", outcome: ".outcome",
  stage: ".stage", experience: ".experience", responseTime: ".response-time",
  lastGap: ".last-gap", reason: ".reason", reportedDate: ".reported-date",
  externalRefAttr: "data-review-id",
};

function extractFromFixture() {
  const { records } = parseReviewPage(FIXTURE, SELECTORS);
  return extractReports({
    records,
    sourcePageUrl: "https://example.com/reviews/demo",
    rawHtmlHash: "fixturehash",
    acquiredAt: "2026-08-22T00:00:00.000Z",
  });
}

describe("extractReports — fixture end to end", () => {
  const result = extractFromFixture();
  const byCompany = (name: string) => result.extracted.filter((e) => e.report.company === name);

  it("drops the partial (company-less) card", () => {
    expect(result.droppedPartial).toBeGreaterThanOrEqual(1);
  });

  it("drops the company-only, no-dimension card as not-evidence", () => {
    expect(result.droppedNoDimension).toBeGreaterThanOrEqual(1);
    // Presidio's company-only card #3 must NOT have produced a report;
    // Presidio's card #5 (has a stage) is the only Presidio report.
    expect(byCompany("Presidio Cloud Systems")).toHaveLength(1);
    expect(byCompany("Presidio Cloud Systems")[0].report.stage).toBe("final");
  });

  it("dedups the in-batch duplicate (card 1 vs card 6) to a single report", () => {
    expect(result.dedupedInBatch).toBeGreaterThanOrEqual(1);
    expect(byCompany("Verdant Softworks")).toHaveLength(1);
  });

  it("maps human phrasing onto the closed enums", () => {
    const aarohi = byCompany("Aarohi Fintech Labs")[0];
    expect(aarohi).toBeDefined();
    expect(aarohi.report.outcome).toBe("no_response"); // "Never heard back"
    expect(aarohi.report.stage).toBe("screening"); // "Recruiter call"
    expect(aarohi.report.reported_month).toBe("2026-03"); // "March 2026" coarsened
  });

  it("drops an unmappable field but keeps a record with other real dimensions", () => {
    const presidio = byCompany("Presidio Cloud Systems")[0];
    expect(presidio.report.outcome).toBeUndefined(); // "¯\\_(ツ)_/¯ unclear" -> dropped
    expect(presidio.report.stage).toBe("final"); // still real evidence
    expect(presidio.report.experience_bucket).toBe("8+");
  });

  it("stamps provenance + extractor version on every report", () => {
    for (const e of result.extracted) {
      expect(e.report.extraction_version).toBe(GENERIC_EXTRACTOR_VERSION);
      expect(e.provenance.extractionMethod).toBe("playwright+node-html-parser");
      expect(e.provenance.rawHtmlHash).toBe("fixturehash");
      expect(e.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("extractReports — unit paths (synthetic records)", () => {
  const base: ParsedRecord = {
    company: null, role: null, outcome: null, stage: null, experience: null,
    responseTime: null, lastGap: null, reason: null, reportedDate: null,
    externalRef: null, partial: false,
  };
  const input = (records: ParsedRecord[]) => ({
    records, sourcePageUrl: "https://example.com/x", rawHtmlHash: "h", acquiredAt: "2026-08-22T00:00:00.000Z",
  });

  it("never invents a metric: an all-unmappable record is dropped as no-dimension", () => {
    const r = extractReports(input([{ ...base, company: "Acme", outcome: "gibberish", stage: "???" }]));
    expect(r.extracted).toHaveLength(0);
    expect(r.droppedNoDimension).toBe(1);
  });

  it("content hash matches normalize.ts's canonical field order for the same values", () => {
    const hash = canonicalContentHash({
      companySlug: "acme", role: "", experienceBucket: "", stage: "", outcome: "offer",
      responseTimeBucket: "", lastInteractionGap: "", reason: "", paymentFlag: "false", reportedMonth: "",
    });
    const r = extractReports(input([{ ...base, company: "Acme", outcome: "Offer" }]));
    expect(r.extracted).toHaveLength(1);
    expect(r.extracted[0].contentHash).toBe(hash);
  });

  it("two records with identical evidence content dedup to one", () => {
    const rec: ParsedRecord = { ...base, company: "Acme", outcome: "Offer", stage: "Final onsite" };
    const r = extractReports(input([rec, { ...rec, externalRef: "different-ref" }]));
    expect(r.extracted).toHaveLength(1);
    expect(r.dedupedInBatch).toBe(1);
  });
});
