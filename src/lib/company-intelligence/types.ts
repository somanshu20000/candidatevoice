/**
 * Company Intelligence — canonical types.
 *
 * These types describe IMPORTED FACTUAL METADATA about employers. They are
 * kept deliberately, structurally separate from the evidence types in
 * src/types/index.ts and src/lib/fingerprint/*. Nothing here references a
 * submission, a rating, an emotion or a person. The only identifier shared with
 * the evidence side is an organization slug, which names an employer.
 *
 * The pipeline moves a record through four shapes:
 *
 *   RawCompanyRecord     what an adapter emits, loosely typed, source-shaped
 *        │  normalize()
 *   NormalizedCompany    cleaned, canonical field names, still unvalidated
 *        │  validate()
 *   ValidatedCompany     shape + value checks passed, safe to stage
 *        │  import (DB)
 *   (rows in company_* tables)
 */

// --- Confidence -------------------------------------------------------------
// Intentionally a DIFFERENT vocabulary from evidence confidence
// ("insufficient" | "single" | "corroborated"). Sharing words across the two
// axes is how a reader comes to believe an imported fact was corroborated by
// candidates. These describe how well-established a metadata value is.
export type MetadataConfidence =
  | "unverified" // asserted by one low-trust source, unchecked
  | "reported" // asserted by a source we accept, single source
  | "cross_checked" // agreed by two or more independent sources
  | "official"; // from the company itself or an official registry

export const METADATA_CONFIDENCE_VALUES: readonly MetadataConfidence[] = [
  "unverified",
  "reported",
  "cross_checked",
  "official",
];

// --- Controlled value sets (mirror the CHECK constraints in 0005) -----------

export type LinkType =
  | "website"
  | "careers"
  | "engineering_blog"
  | "github"
  | "linkedin"
  | "x"
  | "youtube"
  | "instagram"
  | "facebook"
  | "crunchbase"
  | "wikipedia"
  | "press"
  | "other";

export const LINK_TYPES: readonly LinkType[] = [
  "website", "careers", "engineering_blog", "github", "linkedin", "x",
  "youtube", "instagram", "facebook", "crunchbase", "wikipedia", "press", "other",
];

export type SizeBand =
  | "1-10" | "11-50" | "51-200" | "201-500"
  | "501-1000" | "1001-5000" | "5001-10000" | "10000+";

export const SIZE_BANDS: readonly SizeBand[] = [
  "1-10", "11-50", "51-200", "201-500",
  "501-1000", "1001-5000", "5001-10000", "10000+",
];

export type TaxonomyKind = "industry" | "tag" | "technology" | "business_category";

// --- Canonical input (the JSON/CSV seed format) -----------------------------

/** One office location in the seed format. */
export interface SeedLocation {
  city: string;
  region?: string;
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  country: string;
  headquarters?: boolean;
}

/** The canonical seed record — the documented public contract for JSON/CSV. */
export interface RawCompanyRecord {
  /** Display name, e.g. "Google". Required — everything else is optional. */
  name: string;
  /** Alternate spellings, e.g. ["Google LLC", "Alphabet"]. */
  aliases?: string[];
  legal_name?: string;
  description?: string;
  founded_year?: number | string;
  size_band?: string;
  stock_symbol?: string;
  stock_exchange?: string;
  industry?: string;
  industries?: string[];
  tags?: string[];
  technologies?: string[];
  business_categories?: string[];
  website?: string;
  careers_url?: string;
  engineering_blog?: string;
  github_org?: string;
  linkedin?: string;
  x?: string;
  youtube?: string;
  /** Free-form additional links keyed by LinkType. */
  links?: Partial<Record<LinkType, string>>;
  locations?: SeedLocation[];
  headquarters?: SeedLocation;
  hiring_regions?: string[];
  logo_url?: string;
  /** Source key; defaults to the source the import run is attributed to. */
  source?: string;
}

// --- Normalized shape (post-cleaning, pre-validation) -----------------------

export interface NormalizedLink {
  linkType: LinkType;
  url: string;
}

export interface NormalizedLocation {
  city: string;
  region: string | null;
  countryCode: string;
  isHeadquarters: boolean;
}

export interface NormalizedTaxonomy {
  kind: TaxonomyKind;
  /** Canonical key, e.g. "financial_services". */
  key: string;
  /** Human label, e.g. "Financial Services". */
  label: string;
  isPrimary: boolean;
}

export interface NormalizedCompany {
  /** Display name as given. */
  displayName: string;
  /** Canonical slug derived from displayName. */
  slug: string;
  /** Canonical slugs for every alias, de-duplicated, excluding the primary slug. */
  aliasSlugs: string[];
  legalName: string | null;
  description: string | null;
  foundedYear: number | null;
  sizeBand: SizeBand | null;
  stockSymbol: string | null;
  stockExchange: string | null;
  links: NormalizedLink[];
  locations: NormalizedLocation[];
  taxonomy: NormalizedTaxonomy[];
  hiringRegionCodes: string[];
  logoUrl: string | null;
  /** Source key this record is attributed to. */
  sourceKey: string;
}

// --- Validation results -----------------------------------------------------

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  /** Dotted path into the record, e.g. "links.website" or "founded_year". */
  field: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  /** True when there are no `error`-severity issues. Warnings do not block. */
  valid: boolean;
  issues: ValidationIssue[];
}

/** A normalized record paired with its validation outcome. */
export interface ValidatedCompany {
  normalized: NormalizedCompany;
  result: ValidationResult;
}

// --- Adapter (plugin) contract ----------------------------------------------

/**
 * A metadata source is a plugin implementing this interface. The core pipeline
 * (normalize → validate → dedupe → resolve → import) never changes when a new
 * source is added; only a new adapter is written.
 *
 * An adapter's job is narrow and testable: turn whatever the source provides
 * into an array of RawCompanyRecord. It does no cleaning, no validation and no
 * database work — those are the pipeline's job, shared across every source.
 */
export interface SourceAdapter {
  /** Stable key, matches a metadata_sources.key row, e.g. "seed_file". */
  readonly key: string;
  readonly displayName: string;
  /**
   * Whether this adapter's output may be republished, or only consulted. The
   * importer refuses to persist values from an adapter that returns false. A
   * scraper of copyrighted reviews would set this false and therefore be unable
   * to write anything — the type system helps enforce the licensing rule.
   */
  readonly permitsRedistribution: boolean;
  /**
   * Produce raw records from an input. `input` is adapter-defined: a file path,
   * a parsed object, an API cursor. Kept as `unknown` so the pipeline does not
   * couple to any one source's input shape.
   */
  load(input: unknown): Promise<RawCompanyRecord[]>;
}

// --- Import outcome ----------------------------------------------------------

export interface ImportCounts {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
}

export interface ImportReport extends ImportCounts {
  batchId: string | null;
  sourceKey: string;
  adapterKey: string;
  /** Per-record issues, keyed by the record's display name. */
  issues: { name: string; issues: ValidationIssue[] }[];
  /** True when the run was a no-op because an identical batch already completed. */
  alreadyImported: boolean;
}
