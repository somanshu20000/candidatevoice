/**
 * Built-in adapter: seed files.
 *
 * Reads the canonical JSON or CSV seed format (documented in
 * docs/company-intelligence.md) and emits RawCompanyRecord[]. This is the
 * reference implementation of the SourceAdapter contract: it shows a future
 * source author exactly what an adapter is responsible for (parse to
 * RawCompanyRecord) and, by omission, what it is not (no cleaning, no
 * validation, no database).
 *
 * permitsRedistribution is true because a hand-authored or open-data seed file
 * is, by definition, metadata we are entitled to publish. An adapter wrapping a
 * source of copyrighted reviews would set it false and the importer would
 * refuse to persist its output.
 */

import { parseCsv } from "../csv";
import type { RawCompanyRecord, SeedLocation, SourceAdapter } from "../types";

/** Split a delimited cell ("a; b; c" or "a|b") into trimmed non-empty parts. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse a CSV location cell of the form "City, Region, CC[, hq]".
 * Region is optional; a trailing "hq" flag marks headquarters.
 * Multiple locations are separated by "|" at the column level (splitList).
 */
function parseCsvLocation(spec: string): SeedLocation | null {
  const parts = spec.split(",").map((s) => s.trim());
  if (parts.length < 2) return null;
  const isHq = parts[parts.length - 1].toLowerCase() === "hq";
  const core = isHq ? parts.slice(0, -1) : parts;
  const city = core[0];
  const country = core[core.length - 1];
  const region = core.length >= 3 ? core[1] : undefined;
  if (!city || !country) return null;
  return { city, region, country, headquarters: isHq };
}

function coerceRawRecord(value: unknown): RawCompanyRecord | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim() === "") return null;
  // Pass the object through as-is; normalize() is responsible for cleaning
  // every field. The adapter only guarantees the presence of a usable `name`.
  return obj as unknown as RawCompanyRecord;
}

function fromJson(text: string): RawCompanyRecord[] {
  const parsed = JSON.parse(text);
  const array = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { companies?: unknown[] })?.companies) ? (parsed as { companies: unknown[] }).companies : [parsed];
  return array.map(coerceRawRecord).filter((r): r is RawCompanyRecord => r !== null);
}

function fromCsv(text: string): RawCompanyRecord[] {
  const rows = parseCsv(text);
  return rows
    .map((row): RawCompanyRecord | null => {
      const name = row.name?.trim();
      if (!name) return null;
      const record: RawCompanyRecord = { name };
      if (row.aliases) record.aliases = splitList(row.aliases);
      if (row.legal_name) record.legal_name = row.legal_name;
      if (row.description) record.description = row.description;
      if (row.founded_year) record.founded_year = row.founded_year;
      if (row.size_band) record.size_band = row.size_band;
      if (row.stock_symbol) record.stock_symbol = row.stock_symbol;
      if (row.stock_exchange) record.stock_exchange = row.stock_exchange;
      if (row.industry) record.industry = row.industry;
      if (row.industries) record.industries = splitList(row.industries);
      if (row.tags) record.tags = splitList(row.tags);
      if (row.technologies) record.technologies = splitList(row.technologies);
      if (row.business_categories) record.business_categories = splitList(row.business_categories);
      if (row.website) record.website = row.website;
      if (row.careers_url) record.careers_url = row.careers_url;
      if (row.engineering_blog) record.engineering_blog = row.engineering_blog;
      if (row.github_org) record.github_org = row.github_org;
      if (row.linkedin) record.linkedin = row.linkedin;
      if (row.logo_url) record.logo_url = row.logo_url;
      if (row.hiring_regions) record.hiring_regions = splitList(row.hiring_regions);
      if (row.source) record.source = row.source;
      const locations = splitList(row.locations)
        .map(parseCsvLocation)
        .filter((l): l is SeedLocation => l !== null);
      if (locations.length > 0) record.locations = locations;
      return record;
    })
    .filter((r): r is RawCompanyRecord => r !== null);
}

export interface SeedFileInput {
  /** File contents. */
  content: string;
  /** "json" or "csv". If omitted, inferred from a leading "{" or "[". */
  format?: "json" | "csv";
}

export const seedFileAdapter: SourceAdapter = {
  key: "seed_file",
  displayName: "Seed file (JSON/CSV)",
  permitsRedistribution: true,

  async load(input: unknown): Promise<RawCompanyRecord[]> {
    const { content, format } = input as SeedFileInput;
    if (typeof content !== "string") {
      throw new Error("seedFileAdapter.load expects { content: string, format?: 'json'|'csv' }");
    }
    const resolved = format ?? (/^\s*[[{]/.test(content) ? "json" : "csv");
    return resolved === "json" ? fromJson(content) : fromCsv(content);
  },
};
