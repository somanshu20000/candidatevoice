/**
 * Culture theme vocabulary (Phase 4, product-experience audit).
 *
 * MIRRORS the seed data in supabase/migrations/0035_culture_themes.sql,
 * exactly the relationship src/lib/fingerprint/taxonomy.ts already has with
 * migration 0004 for EMOTIONS — this module exists so the wizard, the
 * aggregation engine, and the UI share one typed definition without a round
 * trip. The two must not drift; tests/culture-theme-taxonomy.test.ts parses
 * the migration and asserts every key/label/valence/ordering matches, the
 * same discipline fingerprint-taxonomy.test.ts applies to 0004.
 *
 * A closed, self-selected set of workplace PRACTICES — never about a named
 * person (same rule conduct.ts enforces for conduct_environment).
 */

export type CultureThemeKey =
  | "supportive_managers"
  | "transparent_communication"
  | "good_work_life_balance"
  | "learning_opportunities"
  | "clear_career_growth"
  | "recognizes_contributions"
  | "collaborative_teams"
  | "high_autonomy"
  | "long_hours_expected"
  | "high_pressure_deadlines"
  | "frequent_reorgs"
  | "bureaucratic_processes"
  | "unclear_expectations"
  | "limited_growth_paths";

export interface CultureTheme {
  key: CultureThemeKey;
  label: string;
  valence: "positive" | "negative";
  displayOrder: number;
}

export const CULTURE_THEMES: readonly CultureTheme[] = [
  { key: "supportive_managers", label: "Supportive managers", valence: "positive", displayOrder: 1 },
  { key: "transparent_communication", label: "Transparent communication", valence: "positive", displayOrder: 2 },
  { key: "good_work_life_balance", label: "Good work-life balance", valence: "positive", displayOrder: 3 },
  { key: "learning_opportunities", label: "Learning opportunities", valence: "positive", displayOrder: 4 },
  { key: "clear_career_growth", label: "Clear career growth", valence: "positive", displayOrder: 5 },
  { key: "recognizes_contributions", label: "Recognizes contributions", valence: "positive", displayOrder: 6 },
  { key: "collaborative_teams", label: "Collaborative teams", valence: "positive", displayOrder: 7 },
  { key: "high_autonomy", label: "High autonomy", valence: "positive", displayOrder: 8 },
  { key: "long_hours_expected", label: "Long hours expected", valence: "negative", displayOrder: 9 },
  { key: "high_pressure_deadlines", label: "High-pressure deadlines", valence: "negative", displayOrder: 10 },
  { key: "frequent_reorgs", label: "Frequent reorgs", valence: "negative", displayOrder: 11 },
  { key: "bureaucratic_processes", label: "Bureaucratic processes", valence: "negative", displayOrder: 12 },
  { key: "unclear_expectations", label: "Unclear expectations", valence: "negative", displayOrder: 13 },
  { key: "limited_growth_paths", label: "Limited growth paths", valence: "negative", displayOrder: 14 },
] as const;

export const CULTURE_THEME_KEYS: readonly CultureThemeKey[] = CULTURE_THEMES.map((t) => t.key);

const CULTURE_THEME_BY_KEY = new Map(CULTURE_THEMES.map((t) => [t.key, t]));

export function getCultureTheme(key: CultureThemeKey): CultureTheme | undefined {
  return CULTURE_THEME_BY_KEY.get(key);
}

export function isCultureThemeKey(value: unknown): value is CultureThemeKey {
  return typeof value === "string" && CULTURE_THEME_BY_KEY.has(value as CultureThemeKey);
}
