import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadCompanyAnalytics } from "@/lib/evidence";
import type { CompanyAnalytics } from "@/lib/evidence";
import type { BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";
import { readCandidateId, readCandidatePseudonym } from "@/lib/candidate/server";
import { loadSavedCompanies } from "@/lib/candidate/saved";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Bar from "@/components/charts/Bar";
import SaveButton from "@/components/SaveButton";

export const dynamic = "force-dynamic"; // reads a per-visitor cookie

const MAX_COMPARE = 4; // mirrors /compare's own cap

function dimRate(a: CompanyAnalytics | null, key: BehaviouralDimensionKey): number | null {
  if (!a) return null;
  const d = a.fingerprint.dimensions.find((x) => x.key === key);
  return d && !d.suppressed ? d.metric.value : null;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default async function SavedPage() {
  const candidateId = readCandidateId();
  const pseudonym = readCandidatePseudonym();

  if (!candidateId) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
          <h1 className="font-serif text-4xl text-ink mb-2">Saved companies</h1>
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center mt-8">
            <p className="text-ink-soft mb-1">Nothing saved yet.</p>
            <p className="text-sm text-ink-muted">
              Look for the <span className="font-medium">Save</span> button on any company page.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // candidate_saved_companies has RLS enabled with no policy — only the
  // service role reaches it, same as every other candidate-table read.
  const adminClient = createAdminClient() as unknown as SupabaseClient;
  const entries = await loadSavedCompanies(adminClient, candidateId);

  const anonClient = createClient() as unknown as SupabaseClient;
  const orgIds = entries.map((e) => e.organizationId);
  const [orgRows, analytics] = await Promise.all([
    orgIds.length > 0
      ? anonClient.from("organizations").select("id, slug, display_name").in("id", orgIds).then((r) => r.data ?? [])
      : Promise.resolve([]),
    orgIds.length > 0 ? loadCompanyAnalytics(anonClient).catch(() => null) : Promise.resolve(null),
  ]);

  const orgById = new Map((orgRows as { id: string; slug: string; display_name: string }[]).map((o) => [o.id, o]));
  const analyticsByOrg = new Map<string, CompanyAnalytics>();
  if (analytics) for (const c of [...analytics.ranked, ...analytics.unranked]) analyticsByOrg.set(c.organizationId, c);

  // Preserve save order (most recent first, per loadSavedCompanies); drop any
  // entry whose organization no longer resolves (deleted/merged) rather than
  // rendering a dead row.
  const rows = entries
    .map((e) => ({
      organizationId: e.organizationId,
      org: orgById.get(e.organizationId) ?? null,
      analytics: analyticsByOrg.get(e.organizationId) ?? null,
    }))
    .filter((r): r is typeof r & { org: NonNullable<typeof r.org> } => r.org !== null);

  const compareSlugs = rows.slice(0, MAX_COMPARE).map((r) => r.org.slug);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-8 pb-6 border-b border-rule flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-serif text-4xl text-ink mb-2">Saved companies</h1>
            <p className="text-sm text-ink-soft">
              {rows.length === 0 ? "Nothing saved yet." : `${rows.length} ${rows.length === 1 ? "company" : "companies"} saved.`}
            </p>
          </div>
          {pseudonym && (
            <span
              className="font-mono text-[11px] uppercase tracking-wider text-ink-faint border border-rule rounded-full px-2.5 py-1"
              title="A generated, anonymous label — never a real name, never linked to any report you've submitted."
            >
              {pseudonym}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
            <p className="text-ink-soft mb-1">Nothing saved yet.</p>
            <p className="text-sm text-ink-muted">
              Look for the <span className="font-medium">Save</span> button on any company page.
            </p>
          </div>
        ) : (
          <>
            {rows.length >= 2 && (
              <div className="mb-6">
                <Link
                  href={`/compare?companies=${encodeURIComponent(compareSlugs.join(","))}`}
                  className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
                >
                  Compare {compareSlugs.length === rows.length ? "all saved" : `first ${compareSlugs.length}`} →
                </Link>
              </div>
            )}
            <div className="border border-rule bg-paper-sheet rounded-sm shadow-sheet overflow-hidden">
              {rows.map(({ organizationId, org, analytics: a }) => {
                const ghosting = dimRate(a, "ghosting");
                const offer = dimRate(a, "offer_probability");
                return (
                  <div key={organizationId} className="flex items-center justify-between gap-4 px-5 py-4 border-b border-rule last:border-0">
                    <div className="min-w-0">
                      <Link href={`/company/${encodeURIComponent(org.slug)}`} className="font-serif text-lg text-ink capitalize hover:text-accent transition-colors">
                        {org.display_name}
                      </Link>
                      <div className="flex items-center gap-4 mt-1.5">
                        <div className="w-20">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint block">Ghosted</span>
                          <span className="text-xs text-ink-soft tnum">{pct(ghosting)}</span>
                          <Bar value={ghosting === null ? null : 100 * (1 - ghosting)} tone={ghosting === null ? "neutral" : ghosting <= 0.1 ? "good" : ghosting >= 0.25 ? "bad" : "warn"} className="mt-1" />
                        </div>
                        <div className="w-20">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint block">Offer</span>
                          <span className="text-xs text-ink-soft tnum">{pct(offer)}</span>
                          <Bar value={offer === null ? null : 100 * offer} tone={offer === null ? "neutral" : offer >= 0.4 ? "good" : offer <= 0.15 ? "bad" : "warn"} className="mt-1" />
                        </div>
                        {a?.hqs && (
                          <div className="w-16">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint block">HQS</span>
                            <span className="font-serif text-lg text-ink tnum">{a.hqs.score}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <SaveButton organizationId={organizationId} initialSaved={true} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
