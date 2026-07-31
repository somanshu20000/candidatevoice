"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary: catches errors thrown by the ROOT LAYOUT itself, which
 * error.tsx cannot reach. Because it replaces the root layout, it must supply
 * its own <html> and <body> and import the stylesheet directly.
 *
 * The font CSS variables the design system relies on (--font-sans, --font-serif)
 * are set by next/font on the root <html>, which is exactly what has failed by
 * the time this renders. Styling here is therefore kept to plain utility classes
 * that degrade gracefully to system fonts rather than assuming those variables
 * resolve — this screen must render even when nothing else does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "5rem 1rem" }}>
          <p
            style={{
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              opacity: 0.6,
              marginBottom: "0.75rem",
            }}
          >
            Error
          </p>
          <h1 style={{ fontSize: "1.875rem", marginBottom: "0.75rem" }}>
            CandidateVoice failed to load
          </h1>
          <p style={{ opacity: 0.75, lineHeight: 1.6, marginBottom: "2rem" }}>
            Something went wrong before the page could render. Reloading usually
            fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              border: "1px solid currentColor",
              borderRadius: "2px",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ fontSize: "10px", opacity: 0.5, marginTop: "2rem" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
