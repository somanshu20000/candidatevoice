import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listCompanies, searchCompanies, type CompanyListItem } from "@/lib/company-intelligence/directory";

export const metadata = {
  title: "Companies · CandidateVoice",
  description: "Browse companies and their hiring processes on CandidateVoice.",
};

const PAGE_SIZE = 24;

/**
 * The company directory. Every imported organization is reachable from here,
 * alphabetically, with a search box. Pagination is server-side (range on the
 * query), so the page fetches at most PAGE_SIZE rows regardless of how large
 * the directory grows.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  // The Company Intelligence tables are not in the hand-authored Database type,
  // so the directory helpers take a plain SupabaseClient — same cast the
  // company page uses for loadCompanyProfile.
  const supabase = createClient() as unknown as SupabaseClient;
  const query = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  let items: CompanyListItem[] = [];
  let total = 0;
  let isSearch = false;
  let failed = false;

  try {
    if (query) {
      isSearch = true;
      items = await searchCompanies(supabase, query, 50);
      total = items.length;
    } else {
      const result = await listCompanies(supabase, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      items = result.items;
      total = result.total;
    }
  } catch {
    // A failed query must not look like an empty directory — surface it.
    failed = true;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-8 pb-6 border-b border-rule">
          <h1 className="font-serif text-3xl text-ink mb-1">Companies</h1>
          <p className="text-sm text-ink-muted tnum">
            {isSearch
              ? `${total} ${total === 1 ? "match" : "matches"} for “${query}”`
              : `${total} ${total === 1 ? "company" : "companies"}`}
          </p>
        </div>

        {/* Search — a plain GET form, so results are shareable URLs and work
            without JavaScript. */}
        <form action="/companies" method="get" className="flex gap-2.5 max-w-lg mb-8">
          <label htmlFor="company-directory-search" className="sr-only">
            Search companies
          </label>
          <input
            id="company-directory-search"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by company name…"
            className="flex-1 bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint"
          />
          <button
            type="submit"
            className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover transition-colors whitespace-nowrap"
          >
            Search
          </button>
        </form>

        {failed ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
            <p className="text-sm text-ink-muted">
              The company directory is temporarily unavailable. Please try again.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
            <p className="text-sm text-ink-muted mb-4">
              {isSearch
                ? `No companies match “${query}” yet.`
                : "No companies yet."}
            </p>
            <Link
              href={
                isSearch
                  ? `/submit?company=${encodeURIComponent(query)}`
                  : "/submit"
              }
              className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
            >
              Be the first to share an experience →
            </Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {items.map((company) => (
              <CompanyCard key={company.slug} company={company} />
            ))}
          </div>
        )}

        {/* Pagination — links, not client state, so each page is its own URL.
            Suppressed during search (search returns a single capped set). */}
        {!isSearch && !failed && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <PageLink page={page - 1} disabled={page <= 1} label="← Prev" />
            <span className="text-xs font-mono text-ink-muted px-3 tnum">
              Page {page} of {totalPages}
            </span>
            <PageLink page={page + 1} disabled={page >= totalPages} label="Next →" />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  const cls =
    "text-xs font-mono border border-rule bg-paper-sheet px-3 py-2 rounded-sm text-ink-soft transition-colors";
  if (disabled) {
    return <span className={`${cls} opacity-40 cursor-not-allowed`}>{label}</span>;
  }
  return (
    <Link href={`/companies?page=${page}`} className={`${cls} hover:border-rule-strong`}>
      {label}
    </Link>
  );
}
