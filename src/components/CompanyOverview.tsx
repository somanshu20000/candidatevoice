import Link from "next/link";
import type { CompanyProfileView, CompanyTermView } from "@/lib/company-intelligence/read";
import type { LinkType } from "@/lib/company-intelligence/types";

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

  return (
    <section className="border border-rule bg-paper-sheet rounded-sm shadow-sheet overflow-hidden mb-8">
      <header className="flex items-center justify-between px-6 py-3 border-b border-rule bg-paper-sunk/40">
        <h2 className="font-serif text-lg text-ink">Company facts</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-muted border border-rule px-2 py-0.5 rounded-sm">
          Imported metadata
        </span>
      </header>

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

/** The three profile actions. Share works today; Compare/Wishlist arrive with later phases. */
export function CompanyActions({ slug }: { slug: string }) {
  return (
    <div className="flex flex-wrap gap-2.5 mb-8">
      <Link
        href={`/submit?company=${encodeURIComponent(slug)}`}
        className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
      >
        Share Experience
      </Link>
      <button
        type="button"
        disabled
        title="Company comparison arrives with the Compare page"
        className="inline-flex items-center gap-2 border border-rule bg-paper-sheet text-ink-faint px-5 py-2.5 text-sm font-medium rounded-sm cursor-not-allowed"
      >
        Compare
      </button>
      <button
        type="button"
        disabled
        title="Wishlist arrives with accounts"
        className="inline-flex items-center gap-2 border border-rule bg-paper-sheet text-ink-faint px-5 py-2.5 text-sm font-medium rounded-sm cursor-not-allowed"
      >
        Wishlist
      </button>
    </div>
  );
}
