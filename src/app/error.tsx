"use client";

import Link from "next/link";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

/**
 * Route-segment error boundary. Catches anything thrown while rendering a page
 * — a Supabase outage, a malformed row, an unexpected null — and replaces the
 * raw Next.js error screen with something a visitor can act on.
 *
 * Deliberately does NOT render `error.message`. In production Next.js already
 * redacts it, but on a self-hosted or dev build it can carry connection strings
 * and row contents. The `digest` is the safe correlator to show instead: it
 * matches the entry in the server logs without exposing what went wrong.
 *
 * Renders its own Navbar/Footer because the root layout carries only <html>
 * and <body> — every page in this app supplies its own chrome.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and in Vercel's client error reporting.
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 py-20 w-full flex-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-3">
          Error
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-ink mb-3">
          Something went wrong loading this page
        </h1>
        <p className="text-ink-soft mb-8 leading-relaxed">
          This is on our side, not yours. Try again in a moment — if it keeps
          happening, the evidence data may be temporarily unavailable.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
          >
            Try again
          </button>
          <Link
            href="/companies"
            className="inline-flex items-center gap-2 border border-rule-strong bg-paper-sheet text-ink-soft px-5 py-2.5 text-sm rounded-sm hover:border-ink-faint transition-colors"
          >
            Browse companies
          </Link>
        </div>
        {error.digest && (
          <p className="text-[10px] font-mono text-ink-faint mt-8">
            Reference: {error.digest}
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
}
