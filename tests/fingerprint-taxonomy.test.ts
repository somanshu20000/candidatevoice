/**
 * Taxonomy parity: src/lib/fingerprint/taxonomy.ts must match the seed data in
 * supabase/migrations/0003_fingerprint_model.sql.
 *
 * These are two copies of the same constant — one the database enforces foreign
 * keys against, one the form and aggregation engine read. Drift between them is
 * silent and nasty: a facet renamed in TypeScript but not in SQL produces
 * ratings that violate a foreign key at insert time, in production, on a real
 * submission. This test makes that a build failure instead.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DIMENSIONS,
  EMOTIONS,
  FACETS,
  facetsForDimension,
  collectableDimensions,
  awaitingSourceDimensions,
} from "@/lib/fingerprint/taxonomy";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0003_fingerprint_model.sql"),
  "utf8"
);

/**
 * Pull the seeded value rows for one table out of the migration.
 * Each seed row occupies its own line and starts with "(" — anything else
 * (the `insert into ... values` header, SQL comments, blank lines) is skipped.
 */
function seededRows(table: string): string[][] {
  const start = MIGRATION.indexOf(`insert into ${table}`);
  expect(start, `no seed block found for ${table}`).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("on conflict", start);
  expect(end, `no "on conflict" terminator for ${table}`).toBeGreaterThan(start);

  const rows: string[][] = [];
  for (const line of MIGRATION.slice(start, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(")) continue;
    // Quoted strings first so digits inside a string are consumed as part of
    // the string rather than matched as a bare number.
    const fields = [...trimmed.matchAll(/'((?:[^']|'')*)'|(\d+)/g)].map((m) =>
      m[1] !== undefined ? m[1] : m[2]
    );
    if (fields.length > 0) rows.push(fields);
  }
  return rows;
}

describe("dimensions", () => {
  const rows = seededRows("fingerprint_dimensions");

  it("seeds exactly the dimensions declared in TypeScript", () => {
    expect(rows).toHaveLength(DIMENSIONS.length);
    expect(rows.map((r) => r[0]).sort()).toEqual(
      DIMENSIONS.map((d) => d.key).sort()
    );
  });

  it.each(DIMENSIONS.map((d) => [d.key, d] as const))(
    "%s matches the SQL row",
    (key, dimension) => {
      const row = rows.find((r) => r[0] === key);
      expect(row, `dimension ${key} missing from SQL`).toBeDefined();
      const [, label, description, sourceType, measurement, displayOrder] = row!;
      expect(label).toBe(dimension.label);
      expect(description).toBe(dimension.description);
      expect(sourceType).toBe(dimension.sourceType);
      expect(measurement).toBe(dimension.measurement);
      expect(Number(displayOrder)).toBe(dimension.displayOrder);
    }
  );

  it("declares exactly one emotion-measured dimension", () => {
    expect(DIMENSIONS.filter((d) => d.measurement === "emotion")).toHaveLength(1);
  });

  it("splits dimensions into collectable and awaiting-source with none left over", () => {
    expect(
      collectableDimensions().length + awaitingSourceDimensions().length
    ).toBe(DIMENSIONS.length);
  });
});

describe("facets", () => {
  const rows = seededRows("fingerprint_facets");

  it("seeds exactly the facets declared in TypeScript", () => {
    expect(rows).toHaveLength(FACETS.length);
    expect(rows.map((r) => r[0]).sort()).toEqual(FACETS.map((f) => f.key).sort());
  });

  it.each(FACETS.map((f) => [f.key, f] as const))(
    "%s matches the SQL row",
    (key, facet) => {
      const row = rows.find((r) => r[0] === key);
      expect(row, `facet ${key} missing from SQL`).toBeDefined();
      const [, dimensionKey, label, prompt, anchorLow, anchorHigh, displayOrder] =
        row!;
      expect(dimensionKey).toBe(facet.dimensionKey);
      expect(label).toBe(facet.label);
      expect(prompt).toBe(facet.prompt);
      expect(anchorLow).toBe(facet.anchorLow);
      expect(anchorHigh).toBe(facet.anchorHigh);
      expect(Number(displayOrder)).toBe(facet.displayOrder);
    }
  );

  it("only references dimensions that exist", () => {
    const dimensionKeys = new Set(DIMENSIONS.map((d) => d.key));
    for (const facet of FACETS) {
      expect(dimensionKeys.has(facet.dimensionKey)).toBe(true);
    }
  });

  it("gives every likert dimension with an enabled source at least one facet", () => {
    for (const dimension of collectableDimensions()) {
      if (dimension.measurement !== "likert") continue;
      expect(
        facetsForDimension(dimension.key).length,
        `${dimension.key} has no facets`
      ).toBeGreaterThan(0);
    }
  });

  it("carries distinct anchor labels so the scale is never ambiguous", () => {
    for (const facet of FACETS) {
      expect(facet.anchorLow).not.toBe(facet.anchorHigh);
      expect(facet.anchorLow.length).toBeGreaterThan(0);
      expect(facet.anchorHigh.length).toBeGreaterThan(0);
    }
  });
});

describe("emotions", () => {
  const rows = seededRows("emotions");

  it("seeds exactly the emotions declared in TypeScript", () => {
    expect(rows).toHaveLength(EMOTIONS.length);
    expect(rows.map((r) => r[0]).sort()).toEqual(
      EMOTIONS.map((e) => e.key).sort()
    );
  });

  it.each(EMOTIONS.map((e) => [e.key, e] as const))(
    "%s matches the SQL row",
    (key, emotion) => {
      const row = rows.find((r) => r[0] === key);
      expect(row, `emotion ${key} missing from SQL`).toBeDefined();
      const [, label, valence, displayOrder] = row!;
      expect(label).toBe(emotion.label);
      expect(valence).toBe(emotion.valence);
      expect(Number(displayOrder)).toBe(emotion.displayOrder);
    }
  );

  it("offers both positive and negative options", () => {
    // A vocabulary skewed entirely one way would bias what people report.
    expect(EMOTIONS.some((e) => e.valence === "positive")).toBe(true);
    expect(EMOTIONS.some((e) => e.valence === "negative")).toBe(true);
  });
});
