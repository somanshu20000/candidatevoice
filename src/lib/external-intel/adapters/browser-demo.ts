/**
 * Browser-demo adapter — proves the Playwright acquisition layer
 * (browser-fetch.ts) against a REAL, unmodified headless-Chromium fetch,
 * while keeping every safety property demo.ts already established.
 *
 * WHY THIS EXISTS, AND WHY IT DOESN'T TARGET A REAL HIRING-REVIEW SITE
 * Q-2's own conclusion (docs/q2-source-acquisition-plan.md, DECISIONS.md)
 * is that no JS-rendered, ToS-permitting hiring-review source has been
 * legally cleared: Glassdoor/AmbitionBox carry a recorded proprietary
 * no-redistribution license (D-005 forbids LinkedIn outright); Reddit — the
 * one cleared pilot source — returns structured JSON directly and needs no
 * browser rendering at all. Building a "real" browser adapter against an
 * uncleared site would violate the same Q-2 gate every other adapter in
 * this codebase respects. The honest thing to demonstrate instead: the
 * BROWSER LAYER ITSELF genuinely works (real navigation, real rendered
 * HTML, robots.txt genuinely checked) against a site explicit about
 * allowing this — https://example.com, IANA's reserved documentation
 * domain, already this codebase's own established "safe, never-real"
 * convention for every demo source_url. There is nothing to "extract" from
 * that page (it has no hiring content), so the record's structured fields
 * are deterministic synthetic data, exactly like demo.ts — the difference
 * from demo.ts is that THIS adapter's fetch step is a real browser
 * round-trip, not a pure function.
 *
 * Same safety guarantees as demo.ts: attributed to the `demo` external
 * source (permanently enabled=false — cannot reach public_external_reports
 * regardless of moderation outcome), source_url on example.com,
 * extraction_version tagged 'browser-demo-v1'. The one field demo.ts
 * doesn't have that this adapter adds: `fields_extracted` carries the real
 * fetch's rawHash and fetchedAt, so a reviewer can see this record came from
 * an actual browser navigation, not a hand-written literal.
 */

import type { AcquisitionAdapter, RawExternalReport } from "../../hiring-intel/types";
import { fetchRenderedPage } from "../browser-fetch";

export interface BrowserDemoAdapterInput {
  companyName: string;
  variant?: "rejected" | "offer" | "no_response";
}

const VARIANTS: Record<NonNullable<BrowserDemoAdapterInput["variant"]>, Partial<RawExternalReport>> = {
  rejected: { stage: "technical", outcome: "rejected", response_time_bucket: "8-14" },
  offer: { stage: "final", outcome: "offer", response_time_bucket: "4-7" },
  no_response: { stage: "screening", outcome: "no_response" },
};

/** The one real, permitted browser-fetch target this adapter navigates to. */
export const BROWSER_DEMO_TARGET_URL = "https://example.com/";

export const browserDemoAdapter: AcquisitionAdapter = {
  key: "demo",
  displayName: "Local Demo Source (browser-rendered)",
  async load(input: unknown): Promise<RawExternalReport[]> {
    const { companyName, variant = "rejected" } = (input ?? {}) as BrowserDemoAdapterInput;
    if (!companyName || !companyName.trim()) return [];

    // The real browser round-trip. Throws (never silently substitutes a
    // canned page) if robots.txt disallows it or navigation fails.
    const rendered = await fetchRenderedPage(BROWSER_DEMO_TARGET_URL, { waitUntil: "domcontentloaded" });

    const slugSafe = companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const shape = VARIANTS[variant];

    const record: RawExternalReport = {
      company: companyName.trim(),
      source_url: `https://example.com/browser-demo-source/${slugSafe}/${variant}`,
      external_ref: `browser-demo-${slugSafe}-${variant}-${rendered.rawHash.slice(0, 12)}`,
      role: "Software Engineer",
      reported_month: "2026-06",
      extraction_version: "browser-demo-v1",
      extraction_confidence: 1.0,
      ...shape,
    };
    // Stash real-fetch provenance on the record for the caller to persist
    // into external_reports.fields_extracted — proof this record's source
    // material came from an actual Playwright navigation.
    (record as RawExternalReport & { _browserProvenance?: unknown })._browserProvenance = {
      fetchedUrl: BROWSER_DEMO_TARGET_URL,
      finalUrl: rendered.finalUrl,
      fetchedAt: rendered.fetchedAt,
      rawHtmlHash: rendered.rawHash,
      renderedByteLength: rendered.html.length,
    };
    return [record];
  },
};
