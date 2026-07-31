/**
 * Reported-month formatting.
 *
 * This replaced a relative-date helper that ran on raw `created_at`. Evidence
 * surfaces now carry only YYYY-MM (public_submissions coarsens it), so these
 * tests pin the two properties that matter: the month never shifts across a
 * timezone, and malformed input degrades to a label rather than "Invalid Date".
 */

import { describe, expect, it } from "vitest";
import { formatReportedMonth } from "@/utils/date";

describe("formatReportedMonth", () => {
  it("formats a well-formed month", () => {
    expect(formatReportedMonth("2026-07")).toBe("July 2026");
    expect(formatReportedMonth("2025-01")).toBe("January 2025");
    expect(formatReportedMonth("2025-12")).toBe("December 2025");
  });

  it("does not shift the month across timezones", () => {
    // `new Date("2026-01")` parses as UTC midnight on Jan 1, which renders as
    // December for any viewer west of Greenwich. Parsing the string by hand is
    // the whole reason this helper does not use Date at all.
    expect(formatReportedMonth("2026-01")).toBe("January 2026");
  });

  it("degrades to a label for missing or malformed input", () => {
    expect(formatReportedMonth(null)).toBe("Date unknown");
    expect(formatReportedMonth(undefined)).toBe("Date unknown");
    expect(formatReportedMonth("")).toBe("Date unknown");
    expect(formatReportedMonth("2026")).toBe("Date unknown");
    expect(formatReportedMonth("2026-7")).toBe("Date unknown");
    expect(formatReportedMonth("2026-07-14")).toBe("Date unknown");
    expect(formatReportedMonth("not-a-month")).toBe("Date unknown");
  });

  it("rejects impossible month numbers rather than indexing past the array", () => {
    expect(formatReportedMonth("2026-00")).toBe("Date unknown");
    expect(formatReportedMonth("2026-13")).toBe("Date unknown");
    expect(formatReportedMonth("2026-99")).toBe("Date unknown");
  });
});
