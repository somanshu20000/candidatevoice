const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Render a `YYYY-MM` reported month for display, e.g. "July 2026".
 *
 * Evidence surfaces deliberately carry month granularity, not timestamps —
 * public_submissions (migration 0003) coarsens created_at for exactly this
 * reason. Formatting is done by hand rather than via `new Date(...)` because
 * parsing "2026-07" as a Date lands on the 1st in UTC and can render as the
 * PREVIOUS month for anyone west of Greenwich.
 *
 * Returns "Date unknown" rather than throwing or printing "Invalid Date": a
 * malformed month is missing metadata, not a reason to break the card.
 */
export function formatReportedMonth(reportedMonth: string | null | undefined): string {
  if (!reportedMonth) return "Date unknown";
  const match = /^(\d{4})-(\d{2})$/.exec(reportedMonth);
  if (!match) return "Date unknown";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return "Date unknown";
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
