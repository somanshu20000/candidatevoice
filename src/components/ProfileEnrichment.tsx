"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Fires one on-demand metadata fetch for a company that resolved to an
 * organization but has no profile yet, then refreshes the page to show it.
 *
 * Design constraints:
 * - The page has ALREADY rendered its empty state by the time this mounts.
 *   Enrichment is deferred to the client precisely so a multi-second paced
 *   fetch (WDQS ~1.2s/req) never blocks the server render / TTFB.
 * - Renders NOTHING visible. On success the router refresh brings the real
 *   profile in; on any failure the existing empty state simply stands. A
 *   candidate never sees a spinner or an error for a background nicety.
 * - Fires at most once per mount (StrictMode double-invokes effects in dev;
 *   the ref guards against a duplicate POST). The route's own per-slug lock is
 *   the real cross-client guarantee — this is just politeness.
 */
export default function ProfileEnrichment({ slug }: { slug: string }) {
  const router = useRouter();
  const fired = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (fired.current || done) return;
    fired.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/company/${encodeURIComponent(slug)}/enrich`, { method: "POST" });
        if (cancelled) return;
        // Only refresh when something actually landed — a 404 (no entity) or a
        // 202 (another client is already fetching) means the empty state is
        // still the correct thing to show, so don't thrash the page.
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { sourcesWritten?: string[] } | null;
          if (!cancelled && body?.sourcesWritten && body.sourcesWritten.length > 0) {
            router.refresh();
          }
        }
      } catch {
        // Network error / offline — leave the empty state exactly as it is.
      } finally {
        if (!cancelled) setDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, router, done]);

  return null;
}
