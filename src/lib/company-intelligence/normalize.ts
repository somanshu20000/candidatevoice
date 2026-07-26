/**
 * Company Intelligence — normalization.
 *
 * Turns a loosely-shaped RawCompanyRecord into a NormalizedCompany: canonical
 * field names, trimmed strings, canonical slugs, typed link/location/taxonomy
 * arrays. Pure and deterministic — no I/O, no clock, no database. The same
 * input always yields the same output, which is what makes the import
 * idempotent and the whole thing testable.
 */

import {
  LINK_TYPES,
  SIZE_BANDS,
  type LinkType,
  type NormalizedCompany,
  type NormalizedLink,
  type NormalizedLocation,
  type NormalizedTaxonomy,
  type RawCompanyRecord,
  type SeedLocation,
  type SizeBand,
  type TaxonomyKind,
} from "./types";

/**
 * Canonical organization slug. MUST match the SQL `canonicalize_slug()` in
 * supabase/migrations/0002_organizations.sql exactly, or a record will resolve
 * to a different organization in TypeScript than it does in Postgres.
 *
 * SQL: lower → replace runs of non-[a-z0-9] with '-' → strip leading/trailing
 * '-' → null if empty. This is stricter than normalizeCompanySlug() (which only
 * lowercases and hyphenates whitespace); it additionally folds punctuation.
 * Diacritics are stripped via Unicode decomposition so "Nestlé" → "nestle"
 * rather than being dropped to "nestl".
 */
export function canonicalizeSlug(input: string): string | null {
  const folded = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, ""); // strip combining diacritical marks

  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : null;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function toYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return null;
  return n;
}

function normalizeSizeBand(value: unknown): SizeBand | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return (SIZE_BANDS as readonly string[]).includes(v) ? (v as SizeBand) : null;
}

function normalizeSymbol(value: unknown): string | null {
  const s = cleanString(value, 12);
  return s ? s.toUpperCase() : null;
}

/** Ensure a URL has a scheme; prefix https:// when a bare domain is given. */
export function normalizeUrl(value: unknown): string | null {
  const s = cleanString(value, 500);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** github_org / a full URL / "org" → a canonical GitHub org URL. */
function normalizeGithub(value: unknown): string | null {
  const s = cleanString(value, 200);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return normalizeUrl(s);
  const handle = s.replace(/^@/, "").replace(/^github\.com\//i, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(handle)) return null;
  return `https://github.com/${handle}`;
}

function normalizeLinkedin(value: unknown): string | null {
  const s = cleanString(value, 200);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return normalizeUrl(s);
  const handle = s.replace(/^@/, "").replace(/\/+$/, "");
  return normalizeUrl(`https://www.linkedin.com/company/${handle}`);
}

function collectLinks(raw: RawCompanyRecord): NormalizedLink[] {
  const byType = new Map<LinkType, string>();

  const put = (type: LinkType, url: string | null) => {
    if (url && !byType.has(type)) byType.set(type, url);
  };

  put("website", normalizeUrl(raw.website));
  put("careers", normalizeUrl(raw.careers_url));
  put("engineering_blog", normalizeUrl(raw.engineering_blog));
  put("github", normalizeGithub(raw.github_org));
  put("linkedin", normalizeLinkedin(raw.linkedin));
  put("x", normalizeUrl(raw.x));
  put("youtube", normalizeUrl(raw.youtube));

  if (raw.links) {
    for (const [type, url] of Object.entries(raw.links)) {
      if ((LINK_TYPES as readonly string[]).includes(type)) {
        const normalized =
          type === "github"
            ? normalizeGithub(url)
            : type === "linkedin"
              ? normalizeLinkedin(url)
              : normalizeUrl(url);
        put(type as LinkType, normalized);
      }
    }
  }

  return [...byType.entries()].map(([linkType, url]) => ({ linkType, url }));
}

function normalizeLocation(loc: SeedLocation): NormalizedLocation | null {
  const city = cleanString(loc.city, 120);
  const country = cleanString(loc.country, 2);
  if (!city || !country) return null;
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return {
    city,
    region: cleanString(loc.region, 120),
    countryCode: code,
    isHeadquarters: loc.headquarters === true,
  };
}

function collectLocations(raw: RawCompanyRecord): NormalizedLocation[] {
  const out: NormalizedLocation[] = [];
  const seen = new Set<string>();

  const add = (loc: NormalizedLocation | null) => {
    if (!loc) return;
    const key = `${loc.countryCode}|${loc.region ?? ""}|${loc.city.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(loc);
  };

  if (raw.headquarters) {
    const hq = normalizeLocation(raw.headquarters);
    if (hq) add({ ...hq, isHeadquarters: true });
  }
  for (const loc of raw.locations ?? []) add(normalizeLocation(loc));

  return out;
}

function termKey(label: string): string | null {
  return canonicalizeSlug(label)?.replace(/-/g, "_") ?? null;
}

function collectTaxonomy(raw: RawCompanyRecord): NormalizedTaxonomy[] {
  const out: NormalizedTaxonomy[] = [];
  const seen = new Set<string>();

  const add = (kind: TaxonomyKind, label: unknown, isPrimary: boolean) => {
    const clean = cleanString(label, 120);
    if (!clean) return;
    const key = termKey(clean);
    if (!key) return;
    const dedupKey = `${kind}|${key}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    out.push({ kind, key, label: clean, isPrimary });
  };

  if (raw.industry) add("industry", raw.industry, true);
  for (const i of raw.industries ?? []) add("industry", i, false);
  for (const t of raw.tags ?? []) add("tag", t, false);
  for (const t of raw.technologies ?? []) add("technology", t, false);
  for (const c of raw.business_categories ?? []) add("business_category", c, false);

  return out;
}

function collectAliasSlugs(raw: RawCompanyRecord, primarySlug: string): string[] {
  const out = new Set<string>();
  // The display name's own alternate spellings, plus the raw name itself if it
  // canonicalizes differently from the primary (it should not, but be safe).
  for (const alias of raw.aliases ?? []) {
    const slug = canonicalizeSlug(alias);
    if (slug && slug !== primarySlug) out.add(slug);
  }
  return [...out];
}

function collectHiringRegions(raw: RawCompanyRecord): string[] {
  const out = new Set<string>();
  for (const region of raw.hiring_regions ?? []) {
    const code = cleanString(region, 2)?.toUpperCase();
    if (code && /^[A-Z]{2}$/.test(code)) out.add(code);
  }
  return [...out];
}

/** Normalize one raw record. Returns null only when there is no usable name. */
export function normalizeCompany(
  raw: RawCompanyRecord,
  defaultSourceKey: string
): NormalizedCompany | null {
  const displayName = cleanString(raw.name, 200);
  if (!displayName) return null;

  const slug = canonicalizeSlug(displayName);
  if (!slug) return null;

  return {
    displayName,
    slug,
    aliasSlugs: collectAliasSlugs(raw, slug),
    legalName: cleanString(raw.legal_name, 200),
    description: cleanString(raw.description, 600),
    foundedYear: toYear(raw.founded_year),
    sizeBand: normalizeSizeBand(raw.size_band),
    stockSymbol: normalizeSymbol(raw.stock_symbol),
    stockExchange: cleanString(raw.stock_exchange, 40),
    links: collectLinks(raw),
    locations: collectLocations(raw),
    taxonomy: collectTaxonomy(raw),
    hiringRegionCodes: collectHiringRegions(raw),
    logoUrl: normalizeUrl(raw.logo_url),
    sourceKey: cleanString(raw.source, 60) ?? defaultSourceKey,
  };
}
