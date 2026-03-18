/**
 * CandidateVoice — Input Sanitization Utilities
 *
 * All user-provided text MUST pass through these functions
 * before being stored in the database or rendered to the DOM.
 *
 * Prevents: XSS, HTML injection, excessively long inputs.
 */

/**
 * Strips HTML tags and encodes dangerous characters.
 * Use on all free-text user inputs before DB storage.
 */
export function sanitizeText(input: string): string {
  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
    // Encode remaining angle brackets
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Encode quotes
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    // Trim whitespace
    .trim();
}

/**
 * Truncates text to a maximum character length.
 * Always apply length limits — never trust the client.
 */
export function truncateText(input: string, maxLength: number): string {
  return input.length > maxLength ? input.slice(0, maxLength) : input;
}

/**
 * Sanitize and truncate in one step.
 * Use this for all submission text fields.
 */
export function sanitizeAndTruncate(input: string, maxLength: number): string {
  return truncateText(sanitizeText(input), maxLength);
}

/**
 * Field-specific limits — single source of truth.
 * Must match DB constraints defined in Phase 2 schema.
 */
export const FIELD_LIMITS = {
  ROLE_TITLE: 120,
  REJECTION_REASON: 500,
  EXPERIENCE_TEXT: 2000,
} as const;

/**
 * Validates that a string is non-empty after sanitization.
 */
export function isNonEmpty(input: string): boolean {
  return sanitizeText(input).length > 0;
}

/**
 * Checks if a string contains a recruiter/employee name pattern.
 * Very basic heuristic — Phase 3 will add Hive Moderation for this.
 *
 * ⚠️ LEGAL: Catching recruiter names prevents defamation liability.
 */
export function containsPersonName(input: string): boolean {
  // Flag patterns like "John Smith", "Jane Doe" (two capitalized words)
  const namePattern = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;
  return namePattern.test(input);
}
