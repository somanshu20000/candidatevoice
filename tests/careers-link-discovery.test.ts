/**
 * findCareersLink — pure, no network. Operates on already-fetched HTML (never
 * a second fetch) and is same-origin-only, which is the property that matters
 * most: a hostile page must never be able to get an attacker-controlled URL
 * recorded as a company's careers link.
 */

import { describe, expect, it } from "vitest";
import { findCareersLink } from "@/lib/company-intelligence/adapters/website-meta";

describe("findCareersLink — finds real careers links", () => {
  it("matches an href containing 'careers'", () => {
    const html = `<nav><a href="/careers">Team</a></nav>`;
    expect(findCareersLink(html, "https://acme.example")).toBe("https://acme.example/careers");
  });

  it("matches link TEXT even when the href itself gives no hint", () => {
    const html = `<a href="/work-with-us">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBe("https://acme.example/work-with-us");
  });

  it("matches 'jobs' and 'hiring' variants", () => {
    expect(findCareersLink(`<a href="/jobs">x</a>`, "https://acme.example")).toBe("https://acme.example/jobs");
    expect(findCareersLink(`<a href="/x">We're hiring</a>`, "https://acme.example")).toBe("https://acme.example/x");
  });

  it("resolves a relative href against the base URL", () => {
    expect(findCareersLink(`<a href="careers">x</a>`, "https://acme.example/about")).toBe(
      "https://acme.example/careers"
    );
  });

  it("accepts a subdomain of the same site (jobs.acme.example)", () => {
    expect(findCareersLink(`<a href="https://jobs.acme.example/">Careers</a>`, "https://acme.example")).toBe(
      "https://jobs.acme.example/"
    );
  });

  it("is www-insensitive in both directions", () => {
    expect(findCareersLink(`<a href="https://acme.example/careers">x</a>`, "https://www.acme.example")).toBe(
      "https://acme.example/careers"
    );
    expect(findCareersLink(`<a href="https://www.acme.example/careers">x</a>`, "https://acme.example")).toBe(
      "https://www.acme.example/careers"
    );
  });

  it("returns the FIRST matching anchor, not the last", () => {
    const html = `<a href="/careers-old">Careers</a><a href="/careers-new">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBe("https://acme.example/careers-old");
  });
});

describe("findCareersLink — same-origin enforcement (the property that matters most)", () => {
  it("REJECTS a careers-labelled link pointing at a different domain", () => {
    // The exact attack this exists to prevent: a hostile page embeds an
    // anchor that LOOKS like a careers link but points off-site.
    const html = `<a href="https://evil.example/careers">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBeNull();
  });

  it("rejects a look-alike domain (acme.example.evil.com)", () => {
    const html = `<a href="https://acme.example.evil.com/careers">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBeNull();
  });

  it("falls through to a later same-origin match after rejecting an off-site one", () => {
    const html = `<a href="https://evil.example/careers">Careers</a><a href="/careers">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBe("https://acme.example/careers");
  });
});

describe("findCareersLink — no false positives", () => {
  it("returns null when nothing looks like a careers link", () => {
    const html = `<a href="/about">About</a><a href="/contact">Contact</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBeNull();
  });

  it("returns null on empty or malformed HTML", () => {
    expect(findCareersLink("", "https://acme.example")).toBeNull();
    expect(findCareersLink("<div>no links here</div>", "https://acme.example")).toBeNull();
  });

  it("returns null when the base URL itself is malformed", () => {
    expect(findCareersLink(`<a href="/careers">Careers</a>`, "not-a-url")).toBeNull();
  });

  it("ignores a bare in-page anchor (#careers) rather than treating it as a link", () => {
    const html = `<a href="#careers">Careers</a>`;
    expect(findCareersLink(html, "https://acme.example")).toBeNull();
  });

  it("ignores a non-http(s) scheme (javascript:, mailto:)", () => {
    expect(findCareersLink(`<a href="javascript:void(0)">Careers</a>`, "https://acme.example")).toBeNull();
    expect(findCareersLink(`<a href="mailto:careers@acme.example">Careers jobs</a>`, "https://acme.example")).toBeNull();
  });
});
