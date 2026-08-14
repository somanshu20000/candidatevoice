/**
 * M3.2 — alias derivation + collision-safe planning
 * (src/lib/company-intelligence/alias-derivation.ts).
 *
 * The whole point of aliases is to raise entity-search recall WITHOUT ever
 * misrouting: an alias that resolves to the wrong company, or to two, is worse
 * than no alias. So the load-bearing tests are the collision ones.
 */

import { describe, expect, it } from "vitest";
import {
  deriveAliasCandidates,
  planAliasBackfill,
  type OrgAliasInput,
} from "@/lib/company-intelligence/alias-derivation";

describe("deriveAliasCandidates", () => {
  it("strips a legal suffix: 'Stripe, Inc.' -> 'stripe'", () => {
    const out = deriveAliasCandidates("Stripe, Inc.", null, "stripe-inc");
    expect(out.some((c) => c.aliasSlug === "stripe" && c.source === "legal_suffix")).toBe(true);
  });

  it("generates an acronym for a multi-word name: 'Tata Consultancy Services' -> 'tcs'", () => {
    const out = deriveAliasCandidates("Tata Consultancy Services", null, "tata-consultancy-services");
    expect(out.some((c) => c.aliasSlug === "tcs" && c.source === "acronym")).toBe(true);
  });

  it("takes a domain stem: 'razorpay.com' -> 'razorpay'", () => {
    const out = deriveAliasCandidates("Razorpay Software Pvt Ltd", "razorpay.com", "razorpay-software-pvt-ltd");
    expect(out.some((c) => c.aliasSlug === "razorpay" && c.source === "domain")).toBe(true);
  });

  it("never emits the org's own slug as an alias", () => {
    const out = deriveAliasCandidates("Zoho", "zoho.com", "zoho");
    // domain stem 'zoho' equals ownSlug -> dropped; no other candidate is 'zoho'.
    expect(out.every((c) => c.aliasSlug !== "zoho")).toBe(true);
  });

  it("does not produce an acronym for a single-word name", () => {
    const out = deriveAliasCandidates("Zerodha", null, "zerodha");
    expect(out.some((c) => c.source === "acronym")).toBe(false);
  });

  it("does not produce a legal-suffix alias when there is no suffix", () => {
    const out = deriveAliasCandidates("Freshworks", null, "freshworks");
    expect(out.some((c) => c.source === "legal_suffix")).toBe(false);
  });

  it("excludes legal suffixes and stopwords from the acronym", () => {
    // 'The Boston Consulting Group Inc' -> significant words Boston/Consulting
    // ('the'/'group'/'inc' excluded) -> 'bc', not 'tbcgi'.
    const out = deriveAliasCandidates("The Boston Consulting Group Inc", null, "the-boston-consulting-group-inc");
    const acr = out.find((c) => c.source === "acronym");
    expect(acr?.aliasSlug).toBe("bc");
  });

  it("dedups candidates that collapse to the same slug", () => {
    const out = deriveAliasCandidates("Acme Ltd", "acme.com", "acme-ltd");
    // legal_suffix 'acme' and domain 'acme' are the same slug — one entry only.
    expect(out.filter((c) => c.aliasSlug === "acme")).toHaveLength(1);
  });
});

describe("planAliasBackfill — collision safety", () => {
  const org = (id: string, slug: string, displayName: string, domain: string | null = null): OrgAliasInput => ({
    organizationId: id,
    slug,
    displayName,
    domain,
  });

  it("drops a candidate that collides with an existing organization's slug", () => {
    // "Apple Inc" would derive alias 'apple' — but another org already owns the
    // 'apple' slug, so inserting it would shadow that real company.
    const orgs = [org("1", "apple-inc", "Apple Inc")];
    const plan = planAliasBackfill(orgs, new Set(["apple-inc", "apple"]), new Set());
    expect(plan.inserts.some((i) => i.aliasSlug === "apple")).toBe(false);
    expect(plan.skipped.some((s) => s.aliasSlug === "apple" && s.reason === "collides_with_org_slug")).toBe(true);
  });

  it("drops a candidate that already exists as an alias (idempotency)", () => {
    const orgs = [org("1", "stripe-inc", "Stripe, Inc.")];
    const plan = planAliasBackfill(orgs, new Set(["stripe-inc"]), new Set(["stripe"]));
    expect(plan.inserts.some((i) => i.aliasSlug === "stripe")).toBe(false);
    expect(plan.skipped.some((s) => s.aliasSlug === "stripe" && s.reason === "collides_with_existing_alias")).toBe(true);
  });

  it("drops an alias claimed by two different organizations as ambiguous", () => {
    // Both "Acme Corp" and "Acme Company" derive 'acme'. It cannot resolve to
    // a single company, so NEITHER gets it.
    const orgs = [org("1", "acme-corp", "Acme Corp"), org("2", "acme-company", "Acme Company")];
    const plan = planAliasBackfill(orgs, new Set(["acme-corp", "acme-company"]), new Set());
    expect(plan.inserts.some((i) => i.aliasSlug === "acme")).toBe(false);
    expect(plan.skipped.filter((s) => s.aliasSlug === "acme" && s.reason === "ambiguous_across_orgs")).toHaveLength(2);
  });

  it("inserts a clean, unambiguous alias", () => {
    const orgs = [org("1", "tata-consultancy-services", "Tata Consultancy Services")];
    const plan = planAliasBackfill(orgs, new Set(["tata-consultancy-services"]), new Set());
    expect(plan.inserts.some((i) => i.aliasSlug === "tcs" && i.organizationId === "1")).toBe(true);
  });

  it("is idempotent: feeding a prior plan's inserts back as existing aliases yields nothing new", () => {
    const orgs = [org("1", "stripe-inc", "Stripe, Inc.", "stripe.com")];
    const first = planAliasBackfill(orgs, new Set(["stripe-inc"]), new Set());
    const appliedAliases = new Set(first.inserts.map((i) => i.aliasSlug));
    const second = planAliasBackfill(orgs, new Set(["stripe-inc"]), appliedAliases);
    expect(second.inserts).toHaveLength(0);
  });

  it("the same slug is never planned twice within one batch", () => {
    const orgs = [org("1", "a-ltd", "A Ltd", "shared.com"), org("2", "b-ltd", "B Ltd", "shared.com")];
    const plan = planAliasBackfill(orgs, new Set(["a-ltd", "b-ltd"]), new Set());
    const slugs = plan.inserts.map((i) => i.aliasSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
