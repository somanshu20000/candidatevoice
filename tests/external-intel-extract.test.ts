/**
 * extractReportsFromSource — must never fabricate a RawExternalReport. Today
 * it always returns [] with a documented reason, since PIXELRAG_RENDER_URL is
 * unset in every environment this codebase controls and no per-source
 * URL-discovery mechanism exists yet. This test pins that honesty, not a
 * happy path that doesn't exist.
 */

import { describe, expect, it, afterEach } from "vitest";
import { extractReportsFromSource } from "@/lib/external-intel/extract";
import type { DiscoveredSource } from "@/lib/external-intel/web-discovery";

const ORIGINAL_RENDER_URL = process.env.PIXELRAG_RENDER_URL;

afterEach(() => {
  if (ORIGINAL_RENDER_URL === undefined) delete process.env.PIXELRAG_RENDER_URL;
  else process.env.PIXELRAG_RENDER_URL = ORIGINAL_RENDER_URL;
});

const SOURCE: DiscoveredSource = { id: "s1", key: "reddit", displayName: "Reddit", trustWeight: 0.3 };

describe("extractReportsFromSource", () => {
  it("returns [] with a PIXELRAG_RENDER_URL reason when rendering isn't configured", async () => {
    delete process.env.PIXELRAG_RENDER_URL;
    const result = await extractReportsFromSource(SOURCE, "Acme Corp");
    expect(result.reports).toEqual([]);
    expect(result.reason).toMatch(/PIXELRAG_RENDER_URL/);
  });

  it("still returns [] with a distinct reason once rendering IS configured — no URL-discovery step exists yet", async () => {
    process.env.PIXELRAG_RENDER_URL = "https://self-hosted.example/render";
    const result = await extractReportsFromSource(SOURCE, "Acme Corp");
    expect(result.reports).toEqual([]);
    expect(result.reason).toMatch(/URL-discovery/);
  });
});
