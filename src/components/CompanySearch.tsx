"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeCompanySlug } from "@/lib/company-slug";

export default function CompanySearch() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slug = normalizeCompanySlug(query);
    if (slug) router.push(`/company/${encodeURIComponent(slug)}`);
  }

  return (
    <section className="border-y border-rule bg-paper-sheet">
      <div className="max-w-6xl mx-auto px-4 py-12 w-full">
        <h2 className="font-serif text-2xl text-ink mb-5">Search a company</h2>
        <form onSubmit={handleSubmit} className="flex gap-2.5 max-w-lg">
          {/* Visually hidden label — the input previously had only a placeholder,
              which leaves screen readers without an accessible name. */}
          <label htmlFor="company-search" className="sr-only">
            Company name
          </label>
          <input
            id="company-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Google, Razorpay, Swiggy..."
            className="flex-1 bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            View Hiring Intel
          </button>
        </form>
      </div>
    </section>
  );
}
