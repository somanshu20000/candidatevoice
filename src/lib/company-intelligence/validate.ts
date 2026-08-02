/**
 * Company Intelligence — validation.
 *
 * Checks a NormalizedCompany against the shape and value rules the database
 * will enforce, BEFORE it reaches the database, so a bad record is reported
 * with a useful message instead of a raw Postgres CHECK violation. Pure: no
 * network, no database. URL reachability (a network check) is deliberately NOT
 * here — see checkUrlReachability, which the sync script calls separately.
 *
 * Errors block import; warnings do not. The distinction matters: a missing
 * website is a warning (the record is still useful), a name that canonicalizes
 * to nothing is an error (there is no employer to attach anything to).
 */

import {
  SIZE_BANDS,
  METADATA_CONFIDENCE_VALUES,
  type NormalizedCompany,
  type ValidationIssue,
  type ValidationResult,
} from "./types";

const CURRENT_YEAR = 2026; // Deliberately a constant, not new Date() — keeps validation pure and testable.

function error(field: string, code: string, message: string): ValidationIssue {
  return { field, severity: "error", code, message };
}

function warning(field: string, code: string, message: string): ValidationIssue {
  return { field, severity: "warning", code, message };
}

/** Validate one normalized record. */
export function validateCompany(company: NormalizedCompany): ValidationResult {
  const issues: ValidationIssue[] = [];

  // --- Required identity ---
  if (!company.displayName) {
    issues.push(error("name", "missing_name", "Company name is required."));
  } else if (company.displayName.length > 200) {
    issues.push(error("name", "name_too_long", "Company name exceeds 200 characters."));
  }

  if (!company.slug) {
    issues.push(
      error("name", "unsluggable_name", "Company name does not produce a valid slug (no alphanumeric characters).")
    );
  }

  // --- Founded year ---
  if (company.foundedYear !== null) {
    if (company.foundedYear < 1600 || company.foundedYear > CURRENT_YEAR + 1) {
      issues.push(
        error("founded_year", "founded_year_range", `founded_year ${company.foundedYear} is outside 1600–${CURRENT_YEAR + 1}.`)
      );
    }
  }

  // --- Size band ---
  if (company.sizeBand !== null && !(SIZE_BANDS as readonly string[]).includes(company.sizeBand)) {
    issues.push(
      error("size_band", "invalid_size_band", `size_band must be one of: ${SIZE_BANDS.join(", ")}.`)
    );
  }

  // --- Stock symbol ---
  if (company.stockSymbol !== null && !/^[A-Z0-9.\-]{1,12}$/.test(company.stockSymbol)) {
    issues.push(
      error("stock_symbol", "invalid_symbol", "stock_symbol must be 1–12 chars of A–Z, 0–9, dot or hyphen.")
    );
  }

  // --- Description ---
  if (company.description !== null && company.description.length > 600) {
    issues.push(
      error("description", "description_too_long", "description exceeds 600 characters (this field is for a factual summary, not a review).")
    );
  }

  // --- Links ---
  for (const link of company.links) {
    if (!/^https?:\/\//i.test(link.url)) {
      issues.push(error(`links.${link.linkType}`, "invalid_url_scheme", `${link.linkType} URL must start with http:// or https://.`));
    }
    if (link.url.length > 500) {
      issues.push(error(`links.${link.linkType}`, "url_too_long", `${link.linkType} URL exceeds 500 characters.`));
    }
  }

  // --- Locations ---
  for (const [i, loc] of company.locations.entries()) {
    if (!/^[A-Z]{2}$/.test(loc.countryCode)) {
      issues.push(error(`locations.${i}.country`, "invalid_country", `country must be an ISO 3166-1 alpha-2 code; got "${loc.countryCode}".`));
    }
  }
  const hqCount = company.locations.filter((l) => l.isHeadquarters).length;
  if (hqCount > 1) {
    issues.push(warning("locations", "multiple_hq", `${hqCount} locations are marked as headquarters; only one is expected.`));
  }

  // --- Hiring regions ---
  for (const code of company.hiringRegionCodes) {
    if (!/^[A-Z]{2}$/.test(code)) {
      issues.push(error("hiring_regions", "invalid_region", `hiring region must be an ISO 3166-1 alpha-2 code; got "${code}".`));
    }
  }

  // --- Warnings: thin records ---
  if (company.links.length === 0) {
    issues.push(warning("links", "no_links", "Record has no links. A website or careers page makes the profile far more useful."));
  }
  if (!company.description) {
    issues.push(warning("description", "no_description", "Record has no description."));
  }

  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Detect duplicate primary slugs and conflicting aliases WITHIN a batch, before
 * touching the database. Two records claiming the same primary slug is a
 * duplicate; one record's primary slug appearing as another's alias is a
 * conflict a human must resolve.
 */
export function validateBatchCoherence(companies: NormalizedCompany[]): Map<number, ValidationIssue[]> {
  const issuesByIndex = new Map<number, ValidationIssue[]>();
  const push = (index: number, issue: ValidationIssue) => {
    const list = issuesByIndex.get(index) ?? [];
    list.push(issue);
    issuesByIndex.set(index, list);
  };

  const primaryToIndex = new Map<string, number>();
  companies.forEach((c, i) => {
    const first = primaryToIndex.get(c.slug);
    if (first !== undefined) {
      push(i, error("name", "duplicate_company", `Duplicate of record #${first + 1} ("${companies[first].displayName}") — both canonicalize to "${c.slug}".`));
    } else {
      primaryToIndex.set(c.slug, i);
    }
  });

  // An alias that is another record's primary slug is a cross-record conflict.
  companies.forEach((c, i) => {
    for (const alias of c.aliasSlugs) {
      const owner = primaryToIndex.get(alias);
      if (owner !== undefined && owner !== i) {
        push(i, warning("aliases", "alias_conflicts_with_company", `Alias "${alias}" is also the canonical slug of record #${owner + 1} ("${companies[owner].displayName}").`));
      }
    }
  });

  return issuesByIndex;
}

/** Whether the metadata confidence label is one of the four accepted values. */
export function isValidConfidence(value: string): boolean {
  return (METADATA_CONFIDENCE_VALUES as readonly string[]).includes(value);
}
