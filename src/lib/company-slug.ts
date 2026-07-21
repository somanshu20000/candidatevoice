/**
 * Pure, dependency-free company slug normalization.
 *
 * Deliberately kept in its own module with no Node-only imports (unlike
 * unlock-cookie.ts, which needs `crypto` for HMAC signing) so it's safe to
 * import from client components — importing it from unlock-cookie.ts instead
 * would pull `crypto` into the browser bundle.
 */
export function normalizeCompanySlug(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, "-");
}
