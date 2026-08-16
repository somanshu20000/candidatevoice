/**
 * resolveViaPixelragFallback (enrich.ts) — PixelRAG only ever proposes a
 * candidate; Wikidata's own business-type verification gate
 * (resolveCompanyEntityByQid) still decides. Mocks all three network-facing
 * dependencies to pin that composition without hitting real APIs.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/external-intel/pixelrag", () => ({
  pixelragSearch: vi.fn(),
}));
vi.mock("@/lib/external-intel/wikipedia-qid", () => ({
  wikipediaTitleFromUrl: vi.fn(),
  qidFromWikipediaTitle: vi.fn(),
}));
vi.mock("@/lib/company-intelligence/adapters/wikidata", async () => {
  const actual = await vi.importActual<typeof import("@/lib/company-intelligence/adapters/wikidata")>(
    "@/lib/company-intelligence/adapters/wikidata"
  );
  return { ...actual, resolveCompanyEntityByQid: vi.fn() };
});

import { resolveViaPixelragFallback } from "@/lib/company-intelligence/enrich";
import { pixelragSearch } from "@/lib/external-intel/pixelrag";
import { wikipediaTitleFromUrl, qidFromWikipediaTitle } from "@/lib/external-intel/wikipedia-qid";
import { resolveCompanyEntityByQid } from "@/lib/company-intelligence/adapters/wikidata";

afterEach(() => vi.clearAllMocks());

describe("resolveViaPixelragFallback", () => {
  it("returns null when PixelRAG finds nothing", async () => {
    (pixelragSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await expect(resolveViaPixelragFallback("Nonexistent Corp")).resolves.toBeNull();
  });

  it("skips a match whose URL isn't a Wikipedia article", async () => {
    (pixelragSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "X", url: "https://example.com/x", snippet: null, score: 0.9 },
    ]);
    (wikipediaTitleFromUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(resolveViaPixelragFallback("Acme")).resolves.toBeNull();
    expect(qidFromWikipediaTitle).not.toHaveBeenCalled();
  });

  it("discards a resolved QID that fails Wikidata's own business-type gate — PixelRAG's match never wins on its own", async () => {
    (pixelragSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Acme", url: "https://en.wikipedia.org/wiki/Acme", snippet: null, score: 0.9 },
    ]);
    (wikipediaTitleFromUrl as ReturnType<typeof vi.fn>).mockReturnValue("Acme");
    (qidFromWikipediaTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Q999");
    (resolveCompanyEntityByQid as ReturnType<typeof vi.fn>).mockResolvedValue(null); // not a verified business
    await expect(resolveViaPixelragFallback("Acme")).resolves.toBeNull();
  });

  it("returns the verified entity when the full chain succeeds", async () => {
    const entity = { qid: "Q42", binding: {}, enwikiTitle: "Acme" };
    (pixelragSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "Acme", url: "https://en.wikipedia.org/wiki/Acme", snippet: null, score: 0.9 },
    ]);
    (wikipediaTitleFromUrl as ReturnType<typeof vi.fn>).mockReturnValue("Acme");
    (qidFromWikipediaTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Q42");
    (resolveCompanyEntityByQid as ReturnType<typeof vi.fn>).mockResolvedValue(entity);
    await expect(resolveViaPixelragFallback("Acme")).resolves.toEqual(entity);
  });

  it("tries the next candidate match after one fails to resolve a QID", async () => {
    const entity = { qid: "Q7", binding: {}, enwikiTitle: "Second" };
    (pixelragSearch as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "First", url: "https://en.wikipedia.org/wiki/First", snippet: null, score: 0.9 },
      { title: "Second", url: "https://en.wikipedia.org/wiki/Second", snippet: null, score: 0.8 },
    ]);
    (wikipediaTitleFromUrl as ReturnType<typeof vi.fn>).mockImplementation((url: string) =>
      url.includes("First") ? "First" : "Second"
    );
    (qidFromWikipediaTitle as ReturnType<typeof vi.fn>).mockImplementation((title: string) =>
      title === "First" ? Promise.resolve(null) : Promise.resolve("Q7")
    );
    (resolveCompanyEntityByQid as ReturnType<typeof vi.fn>).mockResolvedValue(entity);
    await expect(resolveViaPixelragFallback("Acme")).resolves.toEqual(entity);
  });
});
