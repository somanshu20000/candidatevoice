import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyAnalytics } from "@/lib/evidence";
import { rankByFit, groupByTier, PREFERENCE_DIMENSION_LABELS } from "@/lib/advisor";
import type { RankCandidateCompany, RankedCompany, FitTier } from "@/lib/advisor";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PreferenceForm from "@/components/advisor/PreferenceForm";
import { readCandidateVector, hasPreferences, readCandidatePseudonym } from "@/lib/candidate/server";

export const dynamic = "force-dynamic"; // reads a per-visitor cookie

const TIER_META: Record<FitTier, { label: string; blurb: string; cls: string }> = {
  best: { label: "Best matches", blurb: "Strong fit for what you care about", cls: "text-good" },
  good: { label: "Good matches", blurb: "A reasonable fit", cls: "text-ink" },
  stretch: { label: "Stretch", blurb: "Mixed against your priorities", cls: "text-warn" },
  avoid: { label: "Poor matches", blurb: "Works against your priorities", cls: "text-bad" },
};

function RankedRow({ company }: { company: RankedCompany }) {
  const { fit } = company;
  const strengths = fit.strengths.map((k) => PREFERENCE_DIMENSION_LABELS[k]);
  const risks = fit.risks.map((k) => PREFERENCE_DIMENSION_LABELS[k]);
  return (
    <Link
      href={`/company/${encodeURIComponent(company.slug)}`}
      className="flex items-start justify-between gap-4 py-3 border-b border-rule last:border-0 hover:bg-paper-sunk -mx-2 px-2 rounded-sm transition-colors"
    >
      <div className="min-w-0">
        <span className="text-sm text-ink capitalize">{company.displayName}</span>
        <div className="text-[11px] text-ink-muted mt-0.5 space-x-3">
          {strengths.length > 0 && <span className="text-good">+ {strengths.join(", ")}</span>}
          {risks.length > 0 && <span className="text-bad">− {risks.join(", ")}</span>}
          {strengths.length === 0 && risks.length === 0 && <span>No standout strengths or risks</span>}
        </div>
        <div className="text-[10px] font-mono text-ink-faint tnum mt-0.5">
          {fit.base.rawTotal} reports · {fit.base.effectiveN.toFixed(1)} effective
        </div>
      </div>
      <span className="font-serif text-2xl text-ink tnum shrink-0">{fit.score}</span>
    </Link>
  );
}

export default async function AdvisorPage() {
  const vector = await readCandidateVector();
  const hasPrefs = hasPreferences(vector);
  // Pure function of the cookie's opaque id (Phase 1, product-experience
  // audit) — null until the visitor has saved anything, since only a save
  // mints the candidate_profiles row the cookie points at.
  const pseudonym = readCandidatePseudonym();

  // Recommendations only when the visitor has priorities to rank against.
  let ranked: RankedCompany[] = [];
  let unratedCount = 0;
  if (hasPrefs) {
    const supabase = createClient() as unknown as SupabaseClient;
    const analytics = await loadCompanyAnalytics(supabase).catch(() => null);
    if (analytics) {
      const companies: RankCandidateCompany[] = [...analytics.ranked, ...analytics.unranked].map((c) => ({
        organizationId: c.organizationId,
        slug: c.slug,
        displayName: c.displayName,
        fingerprint: c.fingerprint,
      }));
      const result = rankByFit(vector, companies);
      ranked = result.ranked;
      unratedCount = result.unrated.length;
    }
  }

  const groups = groupByTier(ranked);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-8 pb-8 border-b border-rule">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h1 className="font-serif text-4xl text-ink">Your career advisor</h1>
            {pseudonym && (
              <span
                className="font-mono text-[11px] uppercase tracking-wider text-ink-faint border border-rule rounded-full px-2.5 py-1"
                title="A generated, anonymous label for your saved preferences — never a real name, never linked to any report you've submitted."
              >
                {pseudonym}
              </span>
            )}
          </div>
          <p className="text-ink-soft leading-relaxed">
            Tell us what matters to you. We rank companies by how their <em>reported hiring
            behaviour</em> matches your priorities — from real evidence, never a guess or a
            resume score.
          </p>
        </div>

        <PreferenceForm initial={vector} />

        <div className="mt-10">
          <h2 className="font-serif text-2xl text-ink mb-1">Recommended for you</h2>
          {!hasPrefs ? (
            <p className="text-sm text-ink-muted mt-3">
              Set your priorities above and save to see companies ranked for you.
            </p>
          ) : ranked.length === 0 ? (
            <p className="text-sm text-ink-muted mt-3">
              No companies have enough reports yet to rank against your priorities. As more
              candidates share their experiences, this list fills in.
            </p>
          ) : (
            <>
              <p className="text-xs text-ink-muted mb-5">
                Ranked by fit with your priorities. Click a company for the full breakdown.
              </p>
              <div className="space-y-8">
                {(Object.keys(TIER_META) as FitTier[]).map((tier) =>
                  groups[tier].length > 0 ? (
                    <div key={tier}>
                      <div className="flex items-baseline gap-3 mb-2">
                        <h3 className={`font-serif text-lg ${TIER_META[tier].cls}`}>{TIER_META[tier].label}</h3>
                        <span className="text-[11px] text-ink-muted">{TIER_META[tier].blurb}</span>
                      </div>
                      <div className="border border-rule bg-paper-sheet rounded-sm px-4 shadow-sheet">
                        {groups[tier].map((c) => (
                          <RankedRow key={c.organizationId} company={c} />
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
              </div>
              {unratedCount > 0 && (
                <p className="text-[11px] text-ink-faint mt-6">
                  {unratedCount} more {unratedCount === 1 ? "company has" : "companies have"} reports but
                  not yet enough to rank against your priorities — listed on their own pages.
                </p>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
