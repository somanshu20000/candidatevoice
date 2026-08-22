"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

/**
 * Save/unsave a company for the anonymous candidate identity (Phase 2,
 * product-experience audit). Talks only to /api/candidate/saved — never
 * reads or writes anything evidence-shaped. `initialSaved` is server-rendered
 * (the page already knows via candidate/saved.ts) so there's no flash of the
 * wrong state and no extra client-side fetch on mount.
 */
export default function SaveButton({
  organizationId,
  initialSaved,
  className,
}: {
  organizationId: string;
  initialSaved: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    const nextSaved = !saved;
    try {
      const res = await fetch("/api/candidate/saved", {
        method: nextSaved ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: organizationId }),
      });
      if (res.ok) setSaved(nextSaved);
    } catch {
      // Network error — leave the toggle exactly as it was, no silent state drift.
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      className={
        className ??
        `inline-flex items-center gap-2 border px-5 py-2.5 text-sm font-medium rounded-sm transition-colors disabled:opacity-60 ${
          saved
            ? "border-accent bg-accent/10 text-accent"
            : "border-rule-strong bg-paper-sheet text-ink-soft hover:border-ink-faint hover:text-ink"
        }`
      }
    >
      {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {saved ? "Saved" : "Save"}
    </button>
  );
}
