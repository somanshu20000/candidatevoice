/**
 * PixelRAG adapter — the ONLY module in this codebase allowed to speak to
 * PixelRAG. DECISIONS.md D-019/D-027: an extraction/retrieval adapter, never
 * the truth layer. It never writes to Supabase, never bypasses moderation,
 * never fabricates a result — every function here degrades to "no match" /
 * "not configured" rather than inventing one.
 *
 * WHAT PIXELRAG ACTUALLY IS (confirmed by reading the project, not assumed):
 * a visual-retrieval system over a FIXED, pre-indexed corpus (currently
 * ~8.28M Wikipedia pages), hosted at https://api.pixelrag.ai with a single
 * unauthenticated `POST /search` endpoint. It is NOT a general web crawler
 * and has NO structured-extraction endpoint on the hosted API — rendering an
 * arbitrary already-known URL (`pixelshot`) and serving a custom index
 * (`pixelrag serve`) are LOCAL-ONLY capabilities of the open-source project,
 * not something the hosted API exposes. Two real, narrow roles follow from
 * that split:
 *
 *  1. pixelragSearch() — REAL, wired, callable today. A semantic/fuzzy
 *     retrieval aid over the Wikipedia corpus. Used by
 *     company-intelligence/enrich.ts as a FALLBACK NAME-RESOLUTION step when
 *     Wikidata's own exact/fuzzy entity search finds nothing — it only ever
 *     proposes a candidate Wikidata QID, which Wikidata's own business-type
 *     verification gate (resolveCompanyEntityByQid) still has to confirm.
 *     PixelRAG never supplies a fact directly.
 *
 *  2. pixelragRender() — a documented STUB until a self-hosted render
 *     endpoint exists. The hosted API has nothing to call. When
 *     PIXELRAG_RENDER_URL is set (pointing at a self-hosted `pixelrag serve`
 *     / pixelshot deployment), this calls it for real; until then it returns
 *     null and callers must treat that as "cannot render," never as "empty
 *     page." This is the wiring point for external-intel/extract.ts's Case-1
 *     pipeline (known company, sparse evidence) once a permitted source
 *     exists (Q-2) and rendering is self-hosted.
 *
 * Env vars (documented here so credentials have exactly one place to land):
 *   PIXELRAG_API_URL     — hosted search base URL. Default https://api.pixelrag.ai.
 *   PIXELRAG_API_KEY     — optional. The hosted /search endpoint needs none
 *                           today; forwarded as a Bearer header if the hosted
 *                           API ever requires one.
 *   PIXELRAG_RENDER_URL  — unset by default. Point this at a self-hosted
 *                           `pixelrag serve` deployment's render endpoint to
 *                           make pixelragRender() do real work instead of
 *                           stubbing.
 */

const DEFAULT_API_URL = "https://api.pixelrag.ai";
const FETCH_TIMEOUT_MS = 8_000;

export interface PixelRagMatch {
  title: string;
  url: string;
  snippet: string | null;
  /** 0..1 relevance score as reported by PixelRAG. Never treated as ground truth. */
  score: number;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function coerceMatches(payload: unknown): PixelRagMatch[] {
  const list =
    payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).results ??
        (payload as Record<string, unknown>).matches ??
        (payload as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(list)) return [];

  const out: PixelRagMatch[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title : typeof row.name === "string" ? row.name : null;
    const url = typeof row.url === "string" ? row.url : typeof row.link === "string" ? row.link : null;
    if (!title || !url) continue;
    const scoreRaw = row.score ?? row.relevance ?? row.confidence;
    const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 0;
    const snippet = typeof row.snippet === "string" ? row.snippet : typeof row.summary === "string" ? row.summary : null;
    out.push({ title, url, snippet, score });
  }
  return out;
}

/**
 * Query PixelRAG's hosted Wikipedia-corpus search. Never throws — a network
 * failure, timeout, or malformed response all degrade to an empty array so a
 * caller's fallback path is never blocked by PixelRAG being unreachable.
 */
export async function pixelragSearch(query: string, limit = 5): Promise<PixelRagMatch[]> {
  const q = query.trim();
  if (!q) return [];

  const baseUrl = process.env.PIXELRAG_API_URL?.trim() || DEFAULT_API_URL;
  const apiKey = process.env.PIXELRAG_API_KEY?.trim();

  try {
    const res = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, "")}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query: q, limit }),
    });
    if (!res.ok) return [];
    const payload = await res.json();
    return coerceMatches(payload).slice(0, limit);
  } catch {
    // Network error, timeout, or non-JSON body — PixelRAG is a fallback aid,
    // never a hard dependency. Callers proceed exactly as if it found nothing.
    return [];
  }
}

export function isPixelragRenderConfigured(): boolean {
  return Boolean(process.env.PIXELRAG_RENDER_URL?.trim());
}

export interface PixelRagRenderResult {
  url: string;
  /** Extracted text content, as rendered by the self-hosted PixelRAG instance. */
  text: string;
}

/**
 * Render an already-known, already-permitted URL via a SELF-HOSTED PixelRAG
 * deployment (the hosted api.pixelrag.ai has no render endpoint — confirmed,
 * not assumed). Returns null, never a fabricated result, whenever
 * PIXELRAG_RENDER_URL is unset — which is the honest state of this codebase
 * today. Set PIXELRAG_RENDER_URL to a running `pixelrag serve` instance's
 * render endpoint to exercise the real path.
 */
export async function pixelragRender(url: string): Promise<PixelRagRenderResult | null> {
  const renderUrl = process.env.PIXELRAG_RENDER_URL?.trim();
  if (!renderUrl) return null;

  try {
    const res = await fetchWithTimeout(renderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Record<string, unknown>;
    const text = typeof payload.text === "string" ? payload.text : null;
    if (!text) return null;
    return { url, text };
  } catch {
    return null;
  }
}
