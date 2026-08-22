/**
 * Culture theme taxonomy parity (Phase 4, product-experience audit): mirrors
 * the "emotions" block in tests/fingerprint-taxonomy.test.ts exactly, for the
 * exact same reason — src/lib/fingerprint/cultureThemeTaxonomy.ts and
 * supabase/migrations/0035_culture_themes.sql's seed data are two copies of
 * one constant, and drift between them produces a foreign-key violation at
 * insert time on a real submission rather than a build failure.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CULTURE_THEMES } from "@/lib/fingerprint/cultureThemeTaxonomy";

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), "supabase/migrations", "0035_culture_themes.sql"),
  "utf8"
);

function seededRows(table: string): string[][] {
  const rows: string[][] = [];
  const start = MIGRATION_SQL.indexOf(`insert into ${table}`);
  expect(start, `no seed block found for ${table}`).toBeGreaterThan(-1);
  const end = MIGRATION_SQL.indexOf("on conflict", start);
  expect(end, `no "on conflict" terminator for ${table}`).toBeGreaterThan(start);

  for (const line of MIGRATION_SQL.slice(start, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(")) continue;
    const fields = [...trimmed.matchAll(/'((?:[^']|'')*)'|(\d+)/g)].map((m) =>
      m[1] !== undefined ? m[1] : m[2]
    );
    if (fields.length > 0) rows.push(fields);
  }
  return rows;
}

describe("culture themes", () => {
  const rows = seededRows("culture_themes");

  it("seeds exactly the themes declared in TypeScript", () => {
    expect(rows).toHaveLength(CULTURE_THEMES.length);
    expect(rows.map((r) => r[0]).sort()).toEqual(CULTURE_THEMES.map((t) => t.key).sort());
  });

  it.each(CULTURE_THEMES.map((t) => [t.key, t] as const))(
    "%s matches the SQL row",
    (key, theme) => {
      const row = rows.find((r) => r[0] === key);
      expect(row, `theme ${key} missing from SQL`).toBeDefined();
      const [, label, valence, displayOrder] = row!;
      expect(label).toBe(theme.label);
      expect(valence).toBe(theme.valence);
      expect(Number(displayOrder)).toBe(theme.displayOrder);
    }
  );

  it("offers both positive and negative options — a one-sided vocabulary would bias what people report", () => {
    expect(CULTURE_THEMES.some((t) => t.valence === "positive")).toBe(true);
    expect(CULTURE_THEMES.some((t) => t.valence === "negative")).toBe(true);
  });

  it("no theme names or implies a specific individual (key/label contain no personal-pronoun or name-shaped pattern)", () => {
    // Cheap, mechanical guardrail mirroring conduct.ts's "never about a named
    // person" rule: themes describe practices ("supportive managers" as a
    // class), never a specific individual. Word-boundary matching so plurals
    // like "managers" don't false-positive on a bare "manager" substring, and
    // "autonomy" doesn't false-positive on a naive "my" substring match.
    const forbidden = [/\bhe\b/, /\bshe\b/, /\bhim\b/, /\bher\b/, /\bmy\b/, /\bnamed\b/, /\bspecific person\b/];
    for (const theme of CULTURE_THEMES) {
      const text = `${theme.key} ${theme.label}`.toLowerCase();
      for (const term of forbidden) {
        expect(term.test(text), `theme "${theme.key}" matches ${term}`).toBe(false);
      }
    }
  });
});
