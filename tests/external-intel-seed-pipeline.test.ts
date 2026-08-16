/**
 * runExternalSeedDiscovery — the Case-1 orchestrator. With today's real state
 * (no acquisition_enabled source, extraction always empty until a real
 * source + self-hosted render exist), every path must resolve to ran:false
 * with a clear reason — never a silent success.
 */

import { describe, expect, it, vi } from "vitest";
import { runExternalSeedDiscovery } from "@/lib/external-intel/seed-pipeline";

function fakeSupabaseNoSources() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeSupabaseWithSource() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ id: "s1", key: "reddit", display_name: "Reddit", trust_weight: 0.3 }],
              error: null,
            }),
          }),
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("runExternalSeedDiscovery", () => {
  it("does not run when no source is permitted — reflects today's honest Q-2-gated state", async () => {
    const result = await runExternalSeedDiscovery(fakeSupabaseNoSources(), "acme", "Acme Corp");
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/acquisition_enabled/);
  });

  it("does not run when a source is permitted but extraction produces nothing", async () => {
    const result = await runExternalSeedDiscovery(fakeSupabaseWithSource(), "acme", "Acme Corp");
    expect(result.ran).toBe(false);
    expect(result.sourceKey).toBe("reddit");
    expect(result.reason).toBeTruthy();
  });
});
