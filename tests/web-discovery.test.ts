/**
 * discoverPermittedSource — the honest "is there a permitted external source
 * at all" check. Today every registered source has acquisition_enabled=false
 * (Q-2, DECISIONS.md), so the real-world assertion is that this returns
 * found:false with a clear, non-fabricated reason — not a happy-path default.
 */

import { describe, expect, it, vi } from "vitest";
import { discoverPermittedSource } from "@/lib/external-intel/web-discovery";

function fakeSupabase(rows: Record<string, unknown>[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("discoverPermittedSource", () => {
  it("returns found:false with a clear reason when no source is acquisition_enabled", async () => {
    const result = await discoverPermittedSource(fakeSupabase([]), "acme");
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toMatch(/acquisition_enabled/);
      expect(result.reason).toMatch(/Q-2|human gate/);
    }
  });

  it("returns the highest-trust-weight source when one is permitted", async () => {
    const result = await discoverPermittedSource(
      fakeSupabase([{ id: "s1", key: "reddit", display_name: "Reddit", trust_weight: "0.3" }]),
      "acme"
    );
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.source).toEqual({ id: "s1", key: "reddit", displayName: "Reddit", trustWeight: 0.3 });
    }
  });

  it("surfaces a query error as found:false rather than throwing", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await discoverPermittedSource(supabase, "acme");
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toMatch(/boom/);
  });
});
