/**
 * Live presence — display threshold. Pure, no I/O. The single source of
 * truth for ">100" so the client component and the API route can never
 * disagree about the cutoff, and so the boundary (exactly 100, 101) has one
 * place to test.
 */

/** Strictly greater than — 100 itself does NOT show, matching "only when
 *  >100 active users" verbatim (not ">=100"). */
export const PRESENCE_THRESHOLD = 100;

export function shouldShowPresence(count: number): boolean {
  return count > PRESENCE_THRESHOLD;
}
