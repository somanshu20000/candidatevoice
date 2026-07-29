import Link from "next/link";
import type { CompanyListItem } from "@/lib/company-intelligence/directory";

/**
 * A directory card for one organization. Links to its profile page. Renders
 * imported metadata only (name, founding year, a description snippet) — no
 * hiring evidence, which lives behind the profile page's own gating.
 *
 * The avatar is a MONOGRAM, drawn client-side from the company's initial, not
 * an <img>. No real logos exist yet (nothing writes company_logos), and a
 * monogram needs zero network requests — so a directory of thousands of cards
 * costs no extra round trips. If stored logos arrive later, this is where an
 * <img src="/api/logo/[slug]"> would replace the monogram.
 */
function Monogram({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-rule-strong bg-paper-sunk font-serif text-lg text-ink-soft"
    >
      {initial}
    </span>
  );
}

export default function CompanyCard({ company }: { company: CompanyListItem }) {
  return (
    <Link
      href={`/company/${encodeURIComponent(company.slug)}`}
      className="group flex flex-col border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet hover:border-rule-strong hover:shadow-sheet-lg transition-all"
    >
      <div className="flex items-start gap-3 mb-2">
        <Monogram name={company.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif text-lg leading-snug text-ink capitalize truncate group-hover:text-accent transition-colors">
              {company.displayName}
            </span>
            {company.foundedYear && (
              <span className="text-[11px] font-mono text-ink-faint shrink-0 tnum">
                {company.foundedYear}
              </span>
            )}
          </div>
        </div>
      </div>

      {company.description ? (
        <p className="text-xs text-ink-muted leading-relaxed clamp-2">
          {company.description}
        </p>
      ) : (
        <p className="text-xs text-ink-faint italic">Profile being built.</p>
      )}

      <span className="mt-auto pt-3 text-[11px] font-mono text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        View company →
      </span>
    </Link>
  );
}
