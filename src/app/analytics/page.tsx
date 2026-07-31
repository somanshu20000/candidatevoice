import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyAnalytics, ghostingLeaderboard, fastestHiring } from "@/lib/evidence";
import type { CompanyAnalytics } from "@/lib/evidence";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const revalidate = 300;

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

function RankingTable({ rows }: { rows: CompanyAnalytics[] }) {
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
          <span className={`font-serif text-2xl tnum shrink-0 ${hqsColor(c.hqs!.score)}`}>{c.hqs!.score}</span>
        </div>
      ))}
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
  const analytics = await loadCompanyAnalytics(supabase as unknown as SupabaseClient).catch(() => null);

  if (!analytics || (analytics.ranked.length === 0 && analytics.unranked.length === 0)) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-14 w-full flex-1">
          <h1 className="font-serif text-4xl text-ink mb-2">Analytics</h1>
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
          title="Hiring Quality ranking"
          subtitle={`${analytics.ranked.length} ranked ${analytics.ranked.length === 1 ? "company" : "companies"}, highest score first`}
        >
          {analytics.ranked.length > 0
            ? <RankingTable rows={analytics.ranked} />
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
