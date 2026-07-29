"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/browser";
import { normalizeCompanySlug } from "@/lib/company-slug";
import { searchCompanies, type CompanyListItem } from "@/lib/company-intelligence/directory";

/**
 * Live company search. Resolves what the user types against real organizations
 * and their aliases (so "Alphabet" finds Google), shows matches in a dropdown,
 * and navigates to the chosen company's page.
 *
 * Fallbacks keep it robust:
 *   - Enter with matches → the first match's page.
 *   - Enter with no matches → the /companies?q= results page (which offers a
 *     "be the first to share" CTA for a company we don't know yet).
 * So the box never dead-ends, even for a company not yet in the directory.
 */
export default function CompanySearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced lookup. A stale-response guard (`cancelled`) prevents an earlier,
  // slower query from overwriting the results of a later one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const matches = await searchCompanies(supabase, q, 8);
        if (cancelled) return;
        setResults(matches);
        setActive(-1);
        setOpen(true);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function goTo(slug: string) {
    router.push(`/company/${encodeURIComponent(slug)}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (active >= 0 && results[active]) return goTo(results[active].slug);
    if (results.length > 0) return goTo(results[0].slug);
    const q = query.trim();
    if (q) router.push(`/companies?q=${encodeURIComponent(q)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <section className="border-y border-rule bg-paper-sheet">
      <div className="max-w-6xl mx-auto px-4 py-12 w-full">
        <h2 className="font-serif text-2xl text-ink mb-5">Search a company</h2>
        <div ref={boxRef} className="relative max-w-lg">
          <form onSubmit={handleSubmit} className="flex gap-2.5">
            <label htmlFor="company-search" className="sr-only">
              Company name
            </label>
            <input
              id="company-search"
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="company-search-results"
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="e.g. Stripe, Razorpay, Zoho…"
              className="flex-1 bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              Search
            </button>
          </form>

          {open && results.length > 0 && (
            <ul
              id="company-search-results"
              role="listbox"
              className="absolute z-20 mt-1.5 w-full max-h-72 overflow-auto border border-rule-strong bg-paper-sheet rounded-sm shadow-sheet-lg"
            >
              {results.map((c, i) => (
                <li key={c.slug} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => goTo(c.slug)}
                    className={`w-full text-left px-4 py-2.5 flex items-baseline justify-between gap-3 transition-colors ${
                      i === active ? "bg-paper-sunk" : "hover:bg-paper-sunk"
                    }`}
                  >
                    <span className="text-sm text-ink capitalize truncate">{c.displayName}</span>
                    {c.foundedYear && (
                      <span className="text-[11px] font-mono text-ink-faint shrink-0 tnum">
                        {c.foundedYear}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
