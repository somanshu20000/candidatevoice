"use client";

import { usePresence } from "./PresenceProvider";

/**
 * Renders the live-presence social-proof line(s), reading from the shared
 * PresenceProvider — never fetches on its own. Renders nothing at all when
 * neither figure clears the threshold (no skeleton, no "0 users," no
 * loading state — the graceful-failure/no-fake-counts requirement applies
 * equally to "not enough real users yet," not just to actual errors).
 *
 * Fixed, small, bottom-of-viewport pill — deliberately low-visual-weight so
 * it reads as ambient social proof, not a notification demanding attention.
 * Mobile-safe: respects the safe-area inset and never exceeds viewport width.
 */
export default function PresenceBadge() {
  const { showGlobal, globalCount, showCompany, companyCount } = usePresence();

  if (!showGlobal && !showCompany) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none px-4"
      style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {showGlobal && globalCount !== null && (
        <span className="font-mono text-[11px] text-ink-muted bg-paper-sheet/95 border border-rule rounded-full px-3 py-1.5 shadow-sheet backdrop-blur-sm">
          {globalCount.toLocaleString()} people are exploring CandidateVoice
        </span>
      )}
      {showCompany && companyCount !== null && (
        <span className="font-mono text-[11px] text-ink-muted bg-paper-sheet/95 border border-rule rounded-full px-3 py-1.5 shadow-sheet backdrop-blur-sm">
          {companyCount.toLocaleString()} people are viewing this company
        </span>
      )}
    </div>
  );
}
