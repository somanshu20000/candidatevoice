/**
 * pixelrag.ts — the only module that talks to PixelRAG. Covers: real
 * hosted-search parsing (several plausible response shapes), the
 * never-throws contract on network/HTTP failure, and the render stub's
 * honest "not configured" default (DECISIONS.md D-027).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { pixelragSearch, pixelragRender, isPixelragRenderConfigured } from "@/lib/external-intel/pixelrag";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("pixelragSearch", () => {
  it("returns [] for an empty query without calling fetch", async () => {
    const result = await pixelragSearch("   ");
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses a `results` array response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "Acme Corp", url: "https://en.wikipedia.org/wiki/Acme_Corp", score: 0.9 }] }),
    });
    const result = await pixelragSearch("Acme");
    expect(result).toEqual([{ title: "Acme Corp", url: "https://en.wikipedia.org/wiki/Acme_Corp", snippet: null, score: 0.9 }]);
  });

  it("parses a `matches` array response with a snippet", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ matches: [{ name: "Acme", link: "https://en.wikipedia.org/wiki/Acme", snippet: "A company." }] }),
    });
    const result = await pixelragSearch("Acme");
    expect(result).toEqual([{ title: "Acme", url: "https://en.wikipedia.org/wiki/Acme", snippet: "A company.", score: 0 }]);
  });

  it("drops entries missing a title or url rather than fabricating one", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: "No URL" }, { url: "https://example.com" }] }),
    });
    const result = await pixelragSearch("Acme");
    expect(result).toEqual([]);
  });

  it("returns [] on a non-ok HTTP response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    const result = await pixelragSearch("Acme");
    expect(result).toEqual([]);
  });

  it("never throws on a network error — degrades to []", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    await expect(pixelragSearch("Acme")).resolves.toEqual([]);
  });

  it("never throws on a malformed JSON body", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(pixelragSearch("Acme")).resolves.toEqual([]);
  });

  it("uses PIXELRAG_API_URL when set", async () => {
    process.env.PIXELRAG_API_URL = "https://custom.pixelrag.example";
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await pixelragSearch("Acme");
    expect(fetch).toHaveBeenCalledWith("https://custom.pixelrag.example/search", expect.any(Object));
  });
});

describe("isPixelragRenderConfigured / pixelragRender", () => {
  it("is not configured when PIXELRAG_RENDER_URL is unset", () => {
    delete process.env.PIXELRAG_RENDER_URL;
    expect(isPixelragRenderConfigured()).toBe(false);
  });

  it("pixelragRender returns null (never fabricates) when unconfigured, without calling fetch", async () => {
    delete process.env.PIXELRAG_RENDER_URL;
    const result = await pixelragRender("https://example.com/some-page");
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pixelragRender calls the configured render endpoint when set", async () => {
    process.env.PIXELRAG_RENDER_URL = "https://self-hosted.example/render";
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ text: "rendered content" }) });
    const result = await pixelragRender("https://example.com/some-page");
    expect(result).toEqual({ url: "https://example.com/some-page", text: "rendered content" });
    expect(isPixelragRenderConfigured()).toBe(true);
  });
});
