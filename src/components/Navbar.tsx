import Link from "next/link";

/**
 * Site navigation.
 *
 * Stays a server component on purpose: a hamburger menu would need client state
 * for three links, so instead the links drop to their own row below ~640px. No
 * JavaScript, no hydration cost, nothing to get stuck open on a slow connection.
 */

const NAV_LINKS = [
  { href: "/companies", label: "Companies" },
  { href: "/browse", label: "Browse" },
  { href: "/analytics", label: "Analytics" },
  { href: "/advisor", label: "Advisor" },
] as const;

export default function Navbar() {
  return (
    <nav className="border-b border-rule bg-paper sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-16 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-serif text-lg sm:text-xl text-ink tracking-tight hover:text-accent transition-colors shrink-0"
          >
            CandidateVoice
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            {/* Full-width layout: links inline. Below sm they move to the row below. */}
            <div className="hidden sm:flex items-center gap-6">
              {NAV_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm text-ink-muted hover:text-ink transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>

            <Link
              href="/submit"
              className="text-sm bg-accent text-paper-sheet font-medium px-3 sm:px-4 py-2 rounded-sm hover:bg-accent-hover transition-colors whitespace-nowrap shrink-0"
            >
              {/* The full label does not fit beside the brand on a 375px screen. */}
              <span className="sm:hidden">Share</span>
              <span className="hidden sm:inline">Share Experience</span>
            </Link>

            <a
              href="https://github.com/somanshu20000/candidatevoice"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:block text-ink-faint hover:text-ink transition-colors shrink-0"
              aria-label="GitHub"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>

        {/* Mobile link row. Hidden once the inline layout has room. */}
        <div className="sm:hidden flex items-center gap-5 pb-3">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm text-ink-muted hover:text-ink transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
