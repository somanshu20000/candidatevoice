import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CompanyCard from "@/components/CompanyCard";
import AddCompanyRequestForm from "@/components/AddCompanyRequestForm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { listCompanies, type CompanyListItem } from "@/lib/company-intelligence/directory";
import { runSearch, type SearchOutcome } from "@/lib/search/retrieve";
import { CAPABILITY_LABELS } from "@/lib/search/unsupported";
import type { SearchResult } from "@/lib/search/types";

export const metadata = {
  title: "Companies · CandidateVoice",
  description: "Search companies by name or by a hiring pattern on CandidateVoice.",
};

const PAGE_SIZE = 24;

/** Current month as YYYY-MM, for the freshness factor. A server component may
 *  read the clock; it is passed into the pure ranker (never read inside it). */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The company directory + search surface (M3.6). No query → the alphabetical,
 * paginated directory (unchanged). A query → runSearch (M3.5), which routes to
 * ranked entity search or evidence-gated signal search and returns one typed
 * outcome. Every result answers "why did this appear?" and "how strong is the
 * evidence?" — and unsupported constraints (location, salary amounts) are named,
 * never silently dropped.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const supabase = createClient() as unknown as SupabaseClient;
  const query = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-14 w-full flex-1">
        {/* Awaited directly rather than rendered as <AsyncComponent/> — the
            project's React types don't accept an async component as a JSX child. */}
        {query ? await SearchView({ query, supabase }) : await DirectoryView({ supabase, page })}
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory (no query) — the original alphabetical, paginated listing.
// ---------------------------------------------------------------------------

async function DirectoryView({ supabase, page }: { supabase: SupabaseClient; page: number }) {
  let items: CompanyListItem[] = [];
  let total = 0;
  let failed = false;
  try {
    const result = await listCompanies(supabase, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    items = result.items;
    total = result.total;
  } catch {
    failed = true;
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Header subtitle={`${total} ${total === 1 ? "company" : "companies"}`} />
      <SearchForm defaultValue="" />
      {failed ? (
        <Unavailable />
      ) : items.length === 0 ? (
        <EmptyState message="No companies yet." href="/submit" cta="Be the first to share an experience →" />
      ) : (
        <CompanyGrid items={items} />
      )}
      {!failed && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <PageLink page={page - 1} disabled={page <= 1} label="← Prev" />
          <span className="text-xs font-mono text-ink-muted px-3 tnum">
            Page {page} of {totalPages}
          </span>
          <PageLink page={page + 1} disabled={page >= totalPages} label="Next →" />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Search (query present) — entity cards or banded signal results.
// ---------------------------------------------------------------------------

async function SearchView({ query, supabase }: { query: string; supabase: SupabaseClient }) {
  let outcome: SearchOutcome | null = null;
  let failed = false;
  try {
    outcome = await runSearch(supabase, query, currentMonth());
  } catch {
    failed = true;
  }

  if (failed || !outcome) {
    return (
      <>
        <Header subtitle={`Results for “${query}”`} />
        <SearchForm defaultValue={query} />
        <Unavailable />
      </>
    );
  }

  const { parsed, primaryMode, entityCompanies, signalResults, signalGatedEmpty } = outcome;
  const subtitle =
    primaryMode === "signal"
      ? `Hiring-signal search for “${query}”`
      : primaryMode === "empty"
        ? `“${query}”`
        : `${entityCompanies.length} ${entityCompanies.length === 1 ? "match" : "matches"} for “${query}”`;

  return (
    <>
      <Header subtitle={subtitle} />
      <SearchForm defaultValue={query} />

      {parsed.unsupported.length > 0 && <UnsupportedNotice outcome={outcome} />}

      {primaryMode === "signal" ? (
        signalGatedEmpty ? (
          <InsufficientState signalLabel={parsed.signals.map((s) => s.label).join(", ")} query={query} />
        ) : (
          <SignalResults results={signalResults} />
        )
      ) : primaryMode === "empty" ? (
        <EmptyState
          message="Try a company name (e.g. Razorpay) or a hiring pattern (e.g. “companies that ghost after technical rounds”)."
          href="/submit"
          cta="Or share your own experience →"
        />
      ) : entityCompanies.length === 0 ? (
        <NoCompanyMatchState query={query} />
      ) : (
        <>
          {parsed.intent === "mixed" && parsed.signals.length > 0 && (
            <p className="text-xs text-ink-muted mb-4">
              You also mentioned{" "}
              <span className="text-ink-soft">{parsed.signals.map((s) => s.label).join(", ")}</span> — open a company
              below to see that on its Hiring Fingerprint.
            </p>
          )}
          <CompanyGrid items={entityCompanies} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Signal results — banded, never interleaved.
// ---------------------------------------------------------------------------

function SignalResults({ results }: { results: SearchResult[] }) {
  const well = results.filter((r) => r.evidence.band === "well_evidenced");
  const limited = results.filter((r) => r.evidence.band === "limited");
  return (
    <div className="space-y-8">
      {well.length > 0 && (
        <BandSection heading="Well evidenced" caption="Enough evidence to read these confidently." results={well} />
      )}
      {limited.length > 0 && (
        <BandSection
          heading="Limited evidence"
          caption="Some evidence, but read these as indicative — not firm conclusions."
          results={limited}
        />
      )}
    </div>
  );
}

function BandSection({ heading, caption, results }: { heading: string; caption: string; results: SearchResult[] }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-serif text-xl text-ink">{heading}</h2>
        <p className="text-xs text-ink-muted">{caption}</p>
      </div>
      <div className="space-y-3">
        {results.map((r) => (
          <SignalResultCard key={r.slug} result={r} />
        ))}
      </div>
    </section>
  );
}

function SignalResultCard({ result }: { result: SearchResult }) {
  const base = result.evidence.base;
  const dir = result.match.dimension?.direction;
  return (
    <Link
      href={`/company/${encodeURIComponent(result.slug)}`}
      className="group block border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet hover:border-rule-strong transition-all"
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="font-serif text-lg text-ink capitalize group-hover:text-accent transition-colors">
          {result.displayName}
        </span>
        <BandChip band={result.evidence.band} />
      </div>
      <p className="text-xs text-ink-soft leading-relaxed mb-2">{result.explanation}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-ink-faint tnum">
        {result.match.dimension && (
          <span className="text-ink-muted">
            {result.match.dimension.label} {dir === "low" ? "↓" : "↑"}
          </span>
        )}
        <span>{base.rawTotal} reports</span>
        <span>{Math.round(base.effectiveN)} effective</span>
        {base.latestMonth && <span>latest {base.latestMonth}</span>}
        <span>{result.evidence.families.includes("external") ? "first-party + external" : "first-party"}</span>
      </div>
    </Link>
  );
}

function BandChip({ band }: { band: SearchResult["evidence"]["band"] }) {
  const map = {
    well_evidenced: { label: "Well evidenced", cls: "text-good border-rule-strong" },
    limited: { label: "Limited", cls: "text-warn border-rule-strong" },
    insufficient: { label: "Insufficient", cls: "text-ink-faint border-rule" },
  } as const;
  const { label, cls } = map[band];
  return (
    <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wide border rounded-sm px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// States + shared bits.
// ---------------------------------------------------------------------------

function InsufficientState({ signalLabel, query }: { signalLabel: string; query: string }) {
  return (
    <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
      <p className="text-sm text-ink-soft mb-1">
        No company has enough evidence yet to answer{signalLabel ? ` “${signalLabel}”` : " this"}.
      </p>
      <p className="text-xs text-ink-muted mb-4">
        This is an honest “not enough data” state — CandidateVoice will not invent a score. Signal results appear once
        approved reports clear the evidence threshold.
      </p>
      <Link
        href={`/submit?company=${encodeURIComponent(query)}`}
        className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
      >
        Share a hiring experience →
      </Link>
    </div>
  );
}

function UnsupportedNotice({ outcome }: { outcome: SearchOutcome }) {
  const caps = Array.from(new Set(outcome.parsed.unsupported.map((u) => u.capability)));
  return (
    <div className="border border-rule bg-paper-sunk rounded-sm p-4 mb-6">
      <p className="text-xs text-ink-soft">
        <span className="font-medium text-ink">Note:</span> CandidateVoice can’t yet filter by{" "}
        {caps.map((c) => CAPABILITY_LABELS[c]).join(" or ")}, so that part of your search was ignored. The rest was
        used.
      </p>
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-8 pb-6 border-b border-rule">
      <h1 className="font-serif text-3xl text-ink mb-1">Companies</h1>
      <p className="text-sm text-ink-muted tnum">{subtitle}</p>
    </div>
  );
}

function SearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form action="/companies" method="get" className="flex gap-2.5 max-w-lg mb-8">
      <label htmlFor="company-directory-search" className="sr-only">
        Search companies or hiring patterns
      </label>
      <input
        id="company-directory-search"
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder="Company name, or a hiring pattern…"
        className="flex-1 bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint"
      />
      <button
        type="submit"
        className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover transition-colors whitespace-nowrap"
      >
        Search
      </button>
    </form>
  );
}

function CompanyGrid({ items }: { items: CompanyListItem[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
      {items.map((company) => (
        <CompanyCard key={company.slug} company={company} />
      ))}
    </div>
  );
}

/** The specific "zero matches for a real company" state — offers the direct
 *  request-queue path (AddCompanyRequestForm) instead of routing into the
 *  full hiring-report wizard, which was the only existing way to reach
 *  company_requests before this route existed. */
function NoCompanyMatchState({ query }: { query: string }) {
  return (
    <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
      <p className="text-sm text-ink-muted mb-1">No company matches “{query}” yet.</p>
      <p className="text-xs text-ink-faint mb-4">If this is a real company, add it — an admin will review it shortly.</p>
      <AddCompanyRequestForm defaultName={query} />
      <p className="text-xs text-ink-faint mt-6">
        Already worked there?{" "}
        <Link href={`/submit?company=${encodeURIComponent(query)}`} className="text-accent hover:underline">
          Share your experience →
        </Link>
      </p>
    </div>
  );
}

function EmptyState({ message, href, cta }: { message: string; href: string; cta: string }) {
  return (
    <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
      <p className="text-sm text-ink-muted mb-4">{message}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
      >
        {cta}
      </Link>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
      <p className="text-sm text-ink-muted">Search is temporarily unavailable. Please try again.</p>
      <p className="text-xs text-ink-faint mt-1">This is a problem on our side, not a search with no matches.</p>
    </div>
  );
}

function PageLink({ page, disabled, label }: { page: number; disabled: boolean; label: string }) {
  const cls = "text-xs font-mono border border-rule bg-paper-sheet px-3 py-2 rounded-sm text-ink-soft transition-colors";
  if (disabled) return <span className={`${cls} opacity-40 cursor-not-allowed`}>{label}</span>;
  return (
    <Link href={`/companies?page=${page}`} className={`${cls} hover:border-rule-strong`}>
      {label}
    </Link>
  );
}
