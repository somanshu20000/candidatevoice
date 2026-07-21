/**
 * CandidateVoice — Input Sanitization Utilities
 *
 * All user-provided text MUST pass through these functions
 * before being stored in the database or rendered to the DOM.
 *
 * Prevents: XSS, HTML injection, excessively long inputs.
 */

/**
 * Strips HTML tags from free-text user input before DB storage.
 *
 * Does not entity-encode the remaining text — every render path in this app
 * goes through React JSX ({value}), which already escapes on output. Encoding
 * here too used to double-encode any lone "<"/">"/quote that survived tag
 * stripping (e.g. "level < 10" stored as "level &lt; 10", then React
 * re-escaped the "&" on render into a literal "&amp;lt;" on screen). Tag
 * stripping remains the actual security control; do not reintroduce manual
 * entity encoding here without removing it from wherever the value is later
 * rendered as raw HTML instead of through JSX.
 */
export function sanitizeText(input: string): string {
  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, "")
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
 * Field-specific limits — single source of truth for server-side truncation.
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
