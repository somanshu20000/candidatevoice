"use client";

import { useEffect } from "react";
import { usePresence } from "./PresenceProvider";

/**
 * Mounted only on the company page. Registers this tab's company scope with
 * the shared PresenceProvider (one session, re-scoped — never a second
 * heartbeat loop) and clears it on unmount/navigation-away, so leaving a
 * company page correctly stops counting that tab toward that company's
 * figure on the very next tick. Renders nothing itself — PresenceBadge
 * (mounted once, in the root layout) is what actually displays the text.
 */
export default function PresenceCompanyScope({ slug }: { slug: string }) {
  const { setCompanySlug } = usePresence();

  useEffect(() => {
    setCompanySlug(slug);
    return () => setCompanySlug(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return null;
}
