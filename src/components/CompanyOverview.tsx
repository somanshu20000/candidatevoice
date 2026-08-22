import Link from "next/link";
import type { CompanyProfileView, CompanyTermView, CompanyLocationView } from "@/lib/company-intelligence/read";
import type { LinkType } from "@/lib/company-intelligence/types";
import ShareButton from "@/components/ShareButton";
import SaveButton from "@/components/SaveButton";
import Bar from "@/components/charts/Bar";

/**
 * Renders imported company metadata. Deliberately framed as "Company facts"
 * with an "Imported" tag and a provenance footnote, so a reader never mistakes
 * third-party metadata for first-party CandidateVoice evidence. The two live in
 * separate cards on the page for the same reason.
 */

const LINK_LABELS: Record<LinkType, string> = {
  website: "Website",
  careers: "Careers",
  engineering_blog: "Engineering blog",
  github: "GitHub",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  crunchbase: "Crunchbase",
  wikipedia: "Wikipedia",
  press: "Press",
  other: "Link",
};

const LINK_ORDER: LinkType[] = [
  "website", "careers", "engineering_blog", "github", "linkedin",
  "x", "youtube", "crunchbase", "wikipedia", "instagram", "facebook", "press", "other",
];

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", DE: "Germany",
  SG: "Singapore", AE: "UAE", AU: "Australia", CA: "Canada", NL: "Netherlands", IE: "Ireland",
};

const SIZE_LABELS: Record<string, string> = {
  "1-10": "1–10", "11-50": "11–50", "51-200": "51–200", "201-500": "201–500",
  "501-1000": "501–1,000", "1001-5000": "1,001–5,000", "5001-10000": "5,001–10,000", "10000+": "10,000+",
};

function country(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

function locationLabel(l: { city: string; region: string | null; countryCode: string }): string {
  return [l.city, l.region, country(l.countryCode)].filter(Boolean).join(", ");
}

/**
 * Group imported office locations by country (Phase 5, product-experience
 * audit). No coordinates exist in this schema (NormalizedLocation only ever
 * carries city/region/countryCode strings — see company-intelligence/types.ts),
 * so a literal pin-map isn't buildable without a schema change; a country
 * breakdown answers "where does this company hire" honestly with the data
 * that's actually collected. Pure — no I/O, easy to unit test.
 */
export function locationBreakdown(locations: CompanyLocationView[]): { country: string; count: number; pct: number }[] {
  if (locations.length === 0) return [];
  const counts = new Map<string, number>();
  for (const l of locations) counts.set(l.countryCode, (counts.get(l.countryCode) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ country: country(code), count, pct: Math.round((count / locations.length) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-rule last:border-0">
      <span className="text-xs font-mono uppercase tracking-wider text-ink-muted w-28 shrink-0">{label}</span>
      <span className="text-sm text-ink-soft">{children}</span>
    </div>
  );
}

function termsOfKind(terms: CompanyTermView[], kind: CompanyTermView["kind"]): string[] {
  return terms
    .filter((t) => t.kind === kind)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((t) => t.label);
}

export default function CompanyOverview({ profile }: { profile: CompanyProfileView }) {
  const industries = termsOfKind(profile.terms, "industry");
  const technologies = termsOfKind(profile.terms, "technology");
  const tags = termsOfKind(profile.terms, "tag");
  const orderedLinks = [...profile.links].sort(
    (a, b) => LINK_ORDER.indexOf(a.linkType) - LINK_ORDER.indexOf(b.linkType)
  );

  // 'unverified' is the marker written by the on-demand enrichment path
  // (src/lib/company-intelligence/enrich.ts) — a profile auto-fetched from
  // public pages that no higher-trust source has confirmed. Say so plainly:
  // a candidate should weight it differently from cross-checked/official data.
  const isProvisional = profile.confidence === "unverified";

  return (
    <section className="border border-rule bg-paper-sheet rounded-sm shadow-sheet overflow-hidden mb-8">
      <header className="flex items-center justify-between px-6 py-3 border-b border-rule bg-paper-sunk/40">
        <h2 className="font-serif text-lg text-ink">Company facts</h2>
        <span
          className={`text-[10px] font-mono uppercase tracking-wider border px-2 py-0.5 rounded-sm ${
            isProvisional ? "text-warn border-[#E3D4AE] bg-[#F4EEDD]" : "text-ink-muted border-rule"
          }`}
        >
          {isProvisional ? "Provisional" : "Imported metadata"}
        </span>
      </header>

      {isProvisional && (
        <p className="px-6 pt-4 text-[11px] text-ink-faint leading-relaxed">
          Auto-fetched from public sources when this page was first opened, and
          not yet verified. Treat as a starting point, not a confirmed record.
        </p>
      )}

      <div className="p-6">
        {profile.description && (
          <div className="mb-5">
            <p className="text-sm text-ink-soft leading-relaxed">{profile.description}</p>
            {profile.descriptionSource?.attributionRequired && (
              <p className="text-[11px] text-ink-faint mt-1.5">
                Source:{" "}
                {(() => {
                  const wikipediaLink = profile.links.find((l) => l.linkType === "wikipedia");
                  return wikipediaLink ? (
                    <a
                      href={wikipediaLink.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline hover:text-accent"
                    >
                      {profile.descriptionSource.label} ↗
                    </a>
                  ) : (
                    profile.descriptionSource.label
                  );
                })()}
                {" · CC BY-SA 4.0"}
              </p>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-x-8">
          <div>
            {profile.headquarters && (
              <FactRow label="Headquarters">{locationLabel(profile.headquarters)}</FactRow>
            )}
            {profile.foundedYear && <FactRow label="Founded">{profile.foundedYear}</FactRow>}
            {profile.sizeBand && (
              <FactRow label="Size">{SIZE_LABELS[profile.sizeBand] ?? profile.sizeBand} employees</FactRow>
            )}
            {profile.stockSymbol && (
              <FactRow label="Listed">
                {profile.stockSymbol}
                {profile.stockExchange ? ` · ${profile.stockExchange}` : ""}
              </FactRow>
            )}
            {industries.length > 0 && <FactRow label="Industry">{industries.join(", ")}</FactRow>}
          </div>

          <div>
            {profile.locations.length > 0 && (
              <FactRow label="Offices">
                {profile.locations
                  .slice()
                  .sort((a, b) => Number(b.isHeadquarters) - Number(a.isHeadquarters))
                  .map((l) => l.city)
                  .join(", ")}
              </FactRow>
            )}
            {profile.hiringRegions.length > 0 && (
              <FactRow label="Hiring in">{profile.hiringRegions.map(country).join(", ")}</FactRow>
            )}
            {technologies.length > 0 && <FactRow label="Tech">{technologies.join(", ")}</FactRow>}
            {tags.length > 0 && <FactRow label="Tags">{tags.join(", ")}</FactRow>}
          </div>
        </div>

        {(() => {
          const breakdown = locationBreakdown(profile.locations);
          if (breakdown.length < 2) return null; // one country isn't a breakdown
          return (
            <div className="mt-5 pt-5 border-t border-rule">
              <span className="text-xs font-mono uppercase tracking-wider text-ink-muted block mb-3">
                Offices by country
              </span>
              <div className="space-y-2.5">
                {breakdown.map((b) => (
                  <div key={b.country}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="text-sm text-ink-soft">{b.country}</span>
                      <span className="text-xs text-ink-faint tnum">
                        {b.count} {b.count === 1 ? "office" : "offices"} · {b.pct}%
                      </span>
                    </div>
                    <Bar value={b.pct} tone="neutral" />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {orderedLinks.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-rule">
            {orderedLinks.map((link) => (
              <a
                key={`${link.linkType}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={`text-xs font-medium px-3 py-1.5 rounded-sm border transition-colors ${
                  link.lastStatus !== null && (link.lastStatus < 200 || link.lastStatus >= 400)
                    ? "border-rule text-ink-faint line-through"
                    : "border-rule-strong text-ink-soft hover:border-accent hover:text-accent"
                }`}
                title={
                  link.lastStatus !== null && (link.lastStatus < 200 || link.lastStatus >= 400)
                    ? "This link was unreachable when last checked"
                    : undefined
                }
              >
                {LINK_LABELS[link.linkType]} ↗
              </a>
            ))}
          </div>
        )}

        <p className="text-[11px] text-ink-faint mt-5">
          Factual metadata imported from public sources — not CandidateVoice hiring evidence.
          {profile.confidence ? ` Confidence: ${profile.confidence.replace("_", "-")}.` : ""}
        </p>
      </div>
    </section>
  );
}

/**
 * Profile actions.
 *
 * Only actions that actually work ship here. Permanently-disabled Compare and
 * Wishlist buttons used to sit alongside this one; they were removed for
 * release rather than left greyed out. A dead control teaches a visitor the
 * product is unfinished, which costs more trust than the missing feature does.
 */
export function CompanyActions({
  slug,
  organizationId,
  initialSaved,
}: {
  slug: string;
  /** Present once the company has resolved to a real organization row — a
   *  slug typed into the URL that doesn't resolve has nothing to save. */
  organizationId?: string;
  initialSaved?: boolean;
}) {
  const displayName = slug.replace(/-/g, " ");
  return (
    <div className="flex flex-wrap gap-2.5 mb-8">
      <Link
        href={`/submit?company=${encodeURIComponent(slug)}`}
        className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
      >
        Share Experience
      </Link>
      <ShareButton
        path={`/company/${encodeURIComponent(slug)}`}
        title={`Hiring reports for ${displayName} — CandidateVoice`}
        label="Share this page"
      />
      {organizationId && <SaveButton organizationId={organizationId} initialSaved={initialSaved ?? false} />}
    </div>
  );
}
