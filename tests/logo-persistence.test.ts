/**
 * Pure decision logic in logo.ts: which Content-Type headers are trusted, and
 * what extension a stored logo gets. The network/Storage half (resilientFetch,
 * store.uploadLogoBytes/upsertLogoRecord) is exercised by live verification —
 * see D3's live check — matching how this codebase always splits pure logic
 * (unit-tested) from I/O (live-verified), never mocked.
 */

import { describe, expect, it } from "vitest";
import { mimeTypeForContentType, extensionFor, MAX_LOGO_BYTES } from "@/lib/company-intelligence/logo";

describe("mimeTypeForContentType", () => {
  it("accepts the four stored types", () => {
    expect(mimeTypeForContentType("image/png")).toBe("image/png");
    expect(mimeTypeForContentType("image/svg+xml")).toBe("image/svg+xml");
    expect(mimeTypeForContentType("image/webp")).toBe("image/webp");
    expect(mimeTypeForContentType("image/jpeg")).toBe("image/jpeg");
  });

  it("normalizes image/jpg to image/jpeg — same format, common header variant", () => {
    expect(mimeTypeForContentType("image/jpg")).toBe("image/jpeg");
  });

  it("strips a charset/parameter suffix and normalizes case", () => {
    expect(mimeTypeForContentType("image/svg+xml; charset=utf-8")).toBe("image/svg+xml");
    expect(mimeTypeForContentType("IMAGE/PNG")).toBe("image/png");
    expect(mimeTypeForContentType("  image/webp  ")).toBe("image/webp");
  });

  it("rejects everything else rather than guessing — never coerces an unknown type", () => {
    expect(mimeTypeForContentType("image/gif")).toBeNull();
    expect(mimeTypeForContentType("text/html")).toBeNull();
    expect(mimeTypeForContentType("application/octet-stream")).toBeNull();
    expect(mimeTypeForContentType("")).toBeNull();
  });
});

describe("extensionFor", () => {
  it("maps each stored mime type to its extension", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/svg+xml")).toBe("svg");
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("MAX_LOGO_BYTES", () => {
  it("matches company_logos_byte_size's CHECK constraint in migration 0005", () => {
    expect(MAX_LOGO_BYTES).toBe(2_097_152);
  });
});
