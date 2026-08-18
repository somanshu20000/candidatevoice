"use client";

import { useState } from "react";
import { Share2, Check as CheckIcon } from "lucide-react";

/**
 * Native share/copy-link only — no attribution, no tracked referral code, no
 * new table. A tracked "who shared this" mechanic would cut directly against
 * D-007 (candidate identity structurally disjoint from evidence); this button
 * intentionally can't be that.
 *
 * navigator.share is the primary path (mobile browsers, some desktop); when
 * unavailable — or the user backs out of the native share sheet — falls back
 * to copying the link, which covers every browser with zero extra dependency.
 */
export default function ShareButton({
  path,
  title,
  label = "Share",
  className,
}: {
  /** Site-relative path, e.g. "/company/razorpay". */
  path: string;
  /** Passed to navigator.share as the share sheet's title. */
  title: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled the share sheet, or the platform rejected it — fall
        // through to clipboard rather than leaving the click looking dead.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (very old browser, insecure context) —
      // nothing more we can safely do without a blocking prompt.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={
        className ??
        "inline-flex items-center gap-2 border border-rule-strong bg-paper-sheet text-ink-soft px-5 py-2.5 text-sm font-medium rounded-sm hover:border-ink-faint hover:text-ink transition-colors"
      }
    >
      {copied ? (
        <>
          <CheckIcon className="h-4 w-4" /> Link copied
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" /> {label}
        </>
      )}
    </button>
  );
}
