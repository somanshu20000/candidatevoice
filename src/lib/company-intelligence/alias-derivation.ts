/**
 * M3.2 — deriving organization aliases from data already held (no network).
 *
 * organization_aliases has ~2 rows across 335 organizations, which is the
 * single largest RECALL gap in entity search: the ranked RPC and the substring
 * pass both query aliases (searchCompanies, directory.ts), they just have
 * almost nothing to find. "Tata Consultancy Services" cannot resolve to TCS
 * because no alias row says so. No code change fixes that — it is a data gap.
 *
 * This module is the PURE core of the backfill: given the organizations we
 * already have (name + optional website domain), derive plausible alias slugs,
 * then plan a collision-SAFE set of inserts. All I/O and the actual write live
 * in scripts/backfill-organization-aliases.ts, which is dry-run by default.
 *
 * Three deterministic derivation sources, and ONLY these (no LinkedIn — D-005,
 * no fetching of any kind):
 *   1. legal-suffix stripping   "Stripe, Inc."            -> "stripe"
 *   2. acronym generation       "Tata Consultancy Services" -> "tcs"
 *   3. domain stem              "razorpay.com"            -> "razorpay"
 *
 * COLLISION SAFETY IS THE LOAD-BEARING RULE. An alias that resolves to the
 * wrong company (or to two companies) is strictly worse than no alias — it
 * silently misroutes a submission. planAliasBackfill therefore drops any
 * candidate that collides with an existing organization slug, an existing
 * alias, or another organization's derived candidate in the same batch.
 */

import { canonicalizeSlug } from "./normalize";

/** Legal-entity suffixes stripped before sluggifying. Order matters only in
 *  that multi-word suffixes ("private limited") are tried as whole trailing
 *  phrases; single tokens are stripped token-wise. Lowercased, no punctuation. */
const LEGAL_SUFFIX_TOKENS = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "pvt",
  "private",
  "llc",
  "llp",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "sa",
  "ag",
  "bv",
  "srl",
  "oy",
  "pte",
  "group",
  "holdings",
]);

/** Words too generic to seed an acronym from, so "The X Company" doesn't
 *  contribute T/C noise. Legal suffixes are also excluded from acronyms. */
const ACRONYM_STOPWORDS = new Set(["the", "and", "of", "for", "&"]);

export type AliasSource = "legal_suffix" | "acronym" | "domain";

export interface AliasCandidate {
  aliasSlug: string;
  source: AliasSource;
}

/** Split a display name into lowercase alphanumeric word tokens. */
function words(displayName: string): string[] {
  return displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "razorpay.com" / "www.razorpay.co.in" -> "razorpay". Returns null when the
 *  domain has no usable stem. Only the first label before the public suffix is
 *  taken; a two-word product domain is intentionally NOT split further. */
function domainStem(domain: string | null): string | null {
  if (!domain) return null;
  const host = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
  if (!host) return null;
  const label = host.split(".")[0];
  return label && label.length >= 2 ? label : null;
}

/**
 * All distinct alias candidates for one organization, from the three sources.
 * Pure: no I/O, no collision checks (planAliasBackfill does those across the
 * whole batch). A candidate equal to the org's own slug is dropped here as
 * trivially redundant.
 */
export function deriveAliasCandidates(
  displayName: string,
  domain: string | null,
  ownSlug: string
): AliasCandidate[] {
  const out: AliasCandidate[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null, source: AliasSource) => {
    if (!raw) return;
    const slug = canonicalizeSlug(raw);
    if (!slug || slug.length < 2) return;
    if (slug === ownSlug) return; // redundant with the canonical slug
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({ aliasSlug: slug, source });
  };

  const toks = words(displayName);

  // 1. Legal-suffix stripping: drop any trailing tokens that are legal
  //    suffixes, then sluggify what remains. Only emit if it actually differs
  //    from the full name (i.e. a suffix was present).
  let end = toks.length;
  while (end > 1 && LEGAL_SUFFIX_TOKENS.has(toks[end - 1])) end--;
  if (end < toks.length && end > 0) {
    add(toks.slice(0, end).join(" "), "legal_suffix");
  }

  // 2. Acronym: initials of the significant words (suffixes + stopwords out).
  //    Only for genuinely multi-word names, and only when the acronym is 2+
  //    letters — a single initial is not a usable alias.
  const significant = toks.filter((t) => !LEGAL_SUFFIX_TOKENS.has(t) && !ACRONYM_STOPWORDS.has(t));
  if (significant.length >= 2) {
    const acronym = significant.map((w) => w[0]).join("");
    if (acronym.length >= 2) add(acronym, "acronym");
  }

  // 3. Domain stem.
  add(domainStem(domain), "domain");

  return out;
}

export interface OrgAliasInput {
  organizationId: string;
  slug: string;
  displayName: string;
  domain: string | null;
}

export interface PlannedAlias {
  organizationId: string;
  displayName: string;
  aliasSlug: string;
  source: AliasSource;
}

export interface SkippedAlias {
  organizationId: string;
  displayName: string;
  aliasSlug: string;
  source: AliasSource;
  reason: "collides_with_org_slug" | "collides_with_existing_alias" | "ambiguous_across_orgs";
}

export interface AliasBackfillPlan {
  inserts: PlannedAlias[];
  skipped: SkippedAlias[];
}

/**
 * Plan a collision-safe batch of alias inserts across all organizations.
 *
 * Drops a candidate when its slug:
 *   - equals ANY organization's canonical slug (would shadow a real company),
 *   - already exists as an alias,
 *   - is derived by MORE THAN ONE organization in this batch (ambiguous — it
 *     cannot resolve to a single company, so it resolves to none).
 *
 * Deterministic and idempotent: running it again after applying a prior plan
 * yields no new inserts, because the applied rows are now in `existingAliasSlugs`.
 */
export function planAliasBackfill(
  orgs: OrgAliasInput[],
  existingOrgSlugs: Set<string>,
  existingAliasSlugs: Set<string>
): AliasBackfillPlan {
  // First pass: gather every candidate and count how many DISTINCT orgs claim
  // each alias slug, so we can drop cross-org ambiguity.
  const claimants = new Map<string, Set<string>>();
  const perOrg: { org: OrgAliasInput; candidates: AliasCandidate[] }[] = [];
  for (const org of orgs) {
    const candidates = deriveAliasCandidates(org.displayName, org.domain, org.slug);
    perOrg.push({ org, candidates });
    for (const c of candidates) {
      const set = claimants.get(c.aliasSlug) ?? new Set<string>();
      set.add(org.organizationId);
      claimants.set(c.aliasSlug, set);
    }
  }

  const inserts: PlannedAlias[] = [];
  const skipped: SkippedAlias[] = [];
  // Track what THIS plan has already committed, so a second org can't also
  // insert the same slug even if it survived the ambiguity check by luck.
  const plannedSlugs = new Set<string>();

  for (const { org, candidates } of perOrg) {
    for (const c of candidates) {
      const base = { organizationId: org.organizationId, displayName: org.displayName, aliasSlug: c.aliasSlug, source: c.source };
      if (existingOrgSlugs.has(c.aliasSlug)) {
        skipped.push({ ...base, reason: "collides_with_org_slug" });
        continue;
      }
      if (existingAliasSlugs.has(c.aliasSlug) || plannedSlugs.has(c.aliasSlug)) {
        skipped.push({ ...base, reason: "collides_with_existing_alias" });
        continue;
      }
      if ((claimants.get(c.aliasSlug)?.size ?? 0) > 1) {
        skipped.push({ ...base, reason: "ambiguous_across_orgs" });
        continue;
      }
      inserts.push(base);
      plannedSlugs.add(c.aliasSlug);
    }
  }

  return { inserts, skipped };
}
