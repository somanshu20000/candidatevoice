/**
 * wikipedia-qid.ts — the bridge from a PixelRAG match URL to a Wikidata QID.
 * wikipediaTitleFromUrl is pure; qidFromWikipediaTitle is network but must
 * degrade to null on any failure (mirrors every other adapter's discipline).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { wikipediaTitleFromUrl, qidFromWikipediaTitle } from "@/lib/external-intel/wikipedia-qid";

describe("wikipediaTitleFromUrl", () => {
  it("extracts and decodes a title from an en.wikipedia.org article URL", () => {
    expect(wikipediaTitleFromUrl("https://en.wikipedia.org/wiki/Acme_Corp")).toBe("Acme Corp");
  });

  it("decodes percent-encoded titles", () => {
    expect(wikipediaTitleFromUrl("https://en.wikipedia.org/wiki/Caf%C3%A9_Inc")).toBe("Café Inc");
  });

  it("returns null for a non-wikipedia host", () => {
    expect(wikipediaTitleFromUrl("https://example.com/wiki/Acme")).toBeNull();
  });

  it("returns null for a non-English wikipedia (different QID-lookup scope)", () => {
    expect(wikipediaTitleFromUrl("https://fr.wikipedia.org/wiki/Acme")).toBeNull();
  });

  it("returns null for a wikipedia URL that isn't an article page", () => {
    expect(wikipediaTitleFromUrl("https://en.wikipedia.org/w/index.php?title=Acme")).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(wikipediaTitleFromUrl("not a url")).toBeNull();
  });
});

describe("qidFromWikipediaTitle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the wikibase_item QID from a pageprops response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "123": { pageprops: { wikibase_item: "Q42" } } } } }),
    });
    await expect(qidFromWikipediaTitle("Acme Corp")).resolves.toBe("Q42");
  });

  it("returns null when no page has a wikibase_item", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { "-1": {} } } }),
    });
    await expect(qidFromWikipediaTitle("Nonexistent Corp")).resolves.toBeNull();
  });

  it("never throws on a network failure — degrades to null", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    await expect(qidFromWikipediaTitle("Acme Corp")).resolves.toBeNull();
  });

  it("never throws on a non-ok response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(qidFromWikipediaTitle("Acme Corp")).resolves.toBeNull();
  });
});
