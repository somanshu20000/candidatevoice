import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyAnalytics, ghostingLeaderboard, fastestHiring, rankCompanies } from "@/lib/evidence";
import type { CompanyAnalytics, RankedCompany } from "@/lib/evidence";
import { loadAllHiringOpportunities } from "@/lib/hiring-intent/timeline";
import { buildHiringAnalytics, hasAnyHiringAnalytics } from "@/lib/hiring-intent/analytics";
import type { HiringAnalytics } from "@/lib/hiring-intent/analytics";
import type { MetricResult } from "@/lib/evidence";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const revalidate = 300;

/** Current month as YYYY-MM, for the freshness factor. Computed here (a server
 *  component may read the clock) and passed into the pure rank function. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function hqsColor(score: number): string {
  if (score >= 80) return "text-good";
  if (score >= 50) return "text-warn";
  return "text-bad";
}

function CompanyLink({ c }: { c: CompanyAnalytics }) {
  return (
    <Link href={`/company/${encodeURIComponent(c.slug)}`} className="text-ink hover:text-accent capitalize">
      {c.displayName}
    </Link>
  );
}

function baseCaption(c: CompanyAnalytics): string {
  const eff = c.base.effectiveN.toFixed(1);
  const total = c.base.rawTotal;
  const ext = c.base.externalRaw > 0 ? ` · ${c.base.externalRaw} external` : "";
  return `${eff} effective of ${total} ${total === 1 ? "report" : "reports"}${ext}`;
}

function RankingTable({ rows }: { rows: RankedCompany[] }) {
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm shadow-sheet overflow-hidden">
      {rows.map((r, i) => {
        const c = r.company;
        // Surface the two factors that can pull a score down the list, so a
        // reader isn't baffled to see a high HQS ranked below a lower one
        // (Part 10 self-critique #1: effectiveN must be explained, not hidden).
        const notes: string[] = [];
        if (r.confidence < 1) notes.push(`${Math.round(r.confidence * 100)}% confidence`);
        if (r.freshness < 0.85) notes.push(`${Math.round(r.freshness * 100)}% freshness`);
        return (
          <div key={c.organizationId} className="flex items-center justify-between gap-3 px-5 py-3 border-b border-rule last:border-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-xs text-ink-faint w-6 shrink-0 tnum">{i + 1}</span>
              <div className="min-w-0">
                <CompanyLink c={c} />
                <p className="text-[10px] text-ink-faint tnum">
                  {baseCaption(c)}{notes.length > 0 && ` · ${notes.join(" · ")}`}
                </p>
              </div>
            </div>
            <span className={`font-serif text-2xl tnum shrink-0 ${hqsColor(c.hqs!.score)}`}>{c.hqs!.score}</span>
          </div>
        );
      })}
    </div>
  );
}

function ScoreList({ rows, score, suffix = "" }: { rows: CompanyAnalytics[]; score: (c: CompanyAnalytics) => number; suffix?: string }) {
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm shadow-sheet overflow-hidden">
      {rows.map((c, i) => (
        <div key={c.organizationId} className="flex items-center justify-between gap-3 px-5 py-3 border-b border-rule last:border-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-xs text-ink-faint w-6 shrink-0 tnum">{i + 1}</span>
            <div className="min-w-0">
              <CompanyLink c={c} />
              <p className="text-[10px] text-ink-faint tnum">{baseCaption(c)}</p>
            </div>
          </div>
          <span className="font-mono text-sm text-ink tnum shrink-0">{Math.round(score(c))}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

/** One platform-wide hiring-event stat. Null renders as an honest dash with
 *  its suppression reason, never a fabricated 0 — same convention as every
 *  other card on this page (baseCaption's effectiveN disclosure). */
function HiringStatCard({ label, value, metric, suffix = "" }: { label: string; value: string | null; metric: MetricResult; suffix?: string }) {
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm shadow-sheet p-5">
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-1.5">{label}</p>
      {value === null ? (
        <p className="text-sm text-ink-faint">
          — {metric.suppressionReason === "insufficient_evidence" ? "not enough opportunities yet" : "no data yet"}
        </p>
      ) : (
        <>
          <p className="font-serif text-3xl text-ink tnum">{value}{suffix}</p>
          <p className="text-[10px] text-ink-faint tnum mt-1">{metric.rawDenominator} {metric.rawDenominator === 1 ? "opportunity" : "opportunities"}</p>
        </>
      )}
    </div>
  );
}

/** Platform-wide reduction over every hiring_opportunity — mirrors the
 *  per-company strip on the company page (src/components/HiringTimeline.tsx),
 *  same analytics.ts engine, same null-not-zero discipline. Not integrated
 *  into HQS (DECISIONS.md Q-3) and HR-update frequency reads "no data yet"
 *  until org auth exists (D-011) — both are the honest state, not bugs. */
function HiringActivitySection({ analytics }: { analytics: HiringAnalytics }) {
  if (!hasAnyHiringAnalytics(analytics)) return null;
  const pct = (m: MetricResult) => (m.value === null ? null : String(Math.round(m.value * 100)));
  return (
    <Section
      title="Hiring activity"
      subtitle="Reduced from candidate-reported hiring events across every tracked role — a role is one company + role pairing, not one report"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <HiringStatCard label="Time to resolution" value={analytics.timeToResolutionDays === null ? null : String(analytics.timeToResolutionDays)} metric={analytics.resolutionMetric} suffix=" days" />
        <HiringStatCard label="Stale-role rate" value={pct(analytics.staleRoleRate)} metric={analytics.staleRoleRate} suffix="%" />
        <HiringStatCard label="Perception matched outcome" value={pct(analytics.perceptionAccuracy)} metric={analytics.perceptionAccuracy} suffix="%" />
        <HiringStatCard label="HR update frequency" value={pct(analytics.hrUpdateFrequency)} metric={analytics.hrUpdateFrequency} suffix="%" />
      </div>
    </Section>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-serif text-xl text-ink mb-1">{title}</h2>
      <p className="text-xs text-ink-muted mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

export default async function AnalyticsPage() {
  const supabase = createClient();
  // Two independent read models — hiring-event analytics loaded regardless of
  // whether company evidence clears its own confidence threshold, so a
  // hiring-events-only state still shows what it can. A failure here is
  // swallowed (empty list → the section self-suppresses) and never blocks the
  // company rankings.
  const [analytics, hiringOpportunities] = await Promise.all([
    loadCompanyAnalytics(supabase as unknown as SupabaseClient).catch(() => null),
    loadAllHiringOpportunities(supabase as unknown as SupabaseClient).catch(() => []),
  ]);
  const hiringAnalytics = buildHiringAnalytics(hiringOpportunities, new Date());

  if (!analytics || (analytics.ranked.length === 0 && analytics.unranked.length === 0)) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
          <h1 className="font-serif text-4xl text-ink mb-2">Analytics</h1>
          <HiringActivitySection analytics={hiringAnalytics} />
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center mt-8">
            <p className="text-ink-soft mb-1">Not enough evidence yet.</p>
            <p className="text-sm text-ink-muted">
              Rankings appear once companies clear the confidence threshold.
            </p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const searchRanked = rankCompanies(analytics.ranked, currentMonth());
  const ghosters = ghostingLeaderboard(analytics).slice(0, 10);
  const fastest = fastestHiring(analytics).slice(0, 10);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-10 pb-6 border-b border-rule">
          <h1 className="font-serif text-4xl text-ink mb-2">Analytics</h1>
          <p className="text-sm text-ink-soft">
            Companies ranked by Hiring Quality Score. Only companies with enough
            evidence to clear the confidence threshold are ranked — every figure
            is shown with the sample behind it.
          </p>
        </div>

        <Section
          title="Top companies"
          subtitle="Ranked by hiring quality, weighted by how much evidence backs the score and how recent it is — a well-evidenced score outranks a thin one"
        >
          {searchRanked.length > 0
            ? <RankingTable rows={searchRanked} />
            : <p className="text-sm text-ink-muted">No company has cleared the confidence threshold yet.</p>}
        </Section>

        {ghosters.length > 0 && (
          <Section title="Most ghosting" subtitle="Highest share of candidates left without a response, ranked companies only">
            <ScoreList rows={ghosters} score={(c) => 100 - c.ghosting.score!} suffix="%" />
          </Section>
        )}

        {fastest.length > 0 && (
          <Section title="Fastest to respond" subtitle="Best response-speed score, ranked companies only">
            <ScoreList rows={fastest} score={(c) => c.responseSpeed.score!} />
          </Section>
        )}

        <HiringActivitySection analytics={hiringAnalytics} />

        {analytics.unranked.length > 0 && (
          <Section
            title="Not yet ranked"
            subtitle="These companies have evidence but not enough to rank with confidence — listed, not scored"
          >
            <div className="border border-dashed border-rule-strong bg-paper-sunk rounded-sm overflow-hidden">
              {analytics.unranked.slice(0, 25).map((c) => (
                <div key={c.organizationId} className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-rule last:border-0">
                  <CompanyLink c={c} />
                  <span className="text-[10px] text-ink-faint tnum shrink-0">{baseCaption(c)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </main>
      <Footer />
    </div>
  );
}
