import Link from "next/link";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { calculateHQS } from "@/utils/hqs";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CompanyOverview, { CompanyActions } from "@/components/CompanyOverview";
import { loadCompanyProfile } from "@/lib/company-intelligence/read";
import type { HiringSubmission } from "@/types/index";
import {
  COOKIE_NAME,
  decodeUnlockedCompaniesCookie,
  normalizeCompanySlug,
} from "@/lib/unlock-cookie";

interface Props {
  params: { slug: string };
}

/**
 * Minimum reports before any derived figure is shown publicly.
 *
 * Matches the gate already applied to the headline HQS number. Named rather than
 * inlined so the two surfaces cannot drift apart — they previously had, with the
 * score suppressed and the breakdown shown from the same sample.
 */
const MIN_SUBMISSIONS_FOR_BREAKDOWN = 5;

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied", screening: "Screening", technical: "Technical",
  hr: "HR", final: "Final",
};

function hqsColor(score: number): string {
  if (score >= 80) return "text-good";
  if (score >= 50) return "text-warn";
  return "text-bad";
}

function hqsBorderColor(score: number): string {
  if (score >= 80) return "border-[#C5DBCC]";
  if (score >= 50) return "border-[#E3D4AE]";
  return "border-[#E6C4BF]";
}

function confidenceBadge(confidence: string) {
  const cfg: Record<string, string> = {
    high:   "bg-[#E8F0EA] text-good border-[#C5DBCC]",
    medium: "bg-[#F4EEDD] text-warn border-[#E3D4AE]",
    low:    "bg-paper-sunk text-ink-muted border-rule-strong",
  };
  return cfg[confidence] ?? cfg.low;
}

function MetricRow({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-rule last:border-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="font-mono text-sm font-medium text-ink tnum">{value}{suffix}</span>
    </div>
  );
}

function StageBar({ data }: { data: HiringSubmission[] }) {
  const total = data.length;
  const stages = Object.keys(STAGE_LABELS) as HiringSubmission["stage"][];
  const counts = stages.map((s) => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: data.filter((d) => d.stage === s).length,
  })).filter((x) => x.count > 0);

  return (
    <div className="space-y-2.5">
      {counts.map(({ stage, label, count }) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="text-xs text-ink-muted w-20 shrink-0">{label}</span>
          <div className="flex-1 bg-paper-sunk rounded-full h-1.5">
            <div
              className="bg-accent h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round((count / total) * 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono text-ink-muted w-8 text-right tnum">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function CompanyPage({ params }: Props) {
  const companySlug = normalizeCompanySlug(decodeURIComponent(params.slug));
  const companyName = companySlug.replace(/-/g, " ");
  const supabase = createClient();
  const cookieStore = cookies();
  const unlockedCompanies = decodeUnlockedCompaniesCookie(
    cookieStore.get(COOKIE_NAME)?.value
  );
  const isUnlocked = unlockedCompanies.includes(companySlug);

  // Evidence and imported metadata are fetched independently — different data
  // families, different queries, never mixed. The metadata read uses an untyped
  // client view because the Company Intelligence tables are not in the Database
  // type; they are all public reference data, so the anon client suffices.
  const [{ data, error }, profile] = await Promise.all([
    supabase
      .from("hiring_submissions")
      .select("*")
      .eq("company", companySlug)
      .eq("is_approved", true),
    // Never let a metadata failure (paused DB, missing RPC, network error) take
    // down the whole company page — the evidence view must still render.
    loadCompanyProfile(supabase as unknown as SupabaseClient, companySlug).catch(() => null),
  ]);

  const rows: HiringSubmission[] = (error || !data) ? [] : data;
  const displayName = profile?.displayName ?? companyName;

  // Zero reports no longer means an empty page: a company seeded from imported
  // metadata still shows a full profile, with an explicit "no reports yet"
  // state instead of the reports.
  if (rows.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-14 w-full flex-1">
          <div className="mb-8 pb-8 border-b border-rule">
            <h1 className="font-serif text-4xl text-ink capitalize mb-2">{displayName}</h1>
            {profile?.hasMetadata && (
              <p className="text-xs font-mono uppercase tracking-wider text-ink-muted">
                Company profile · no hiring reports yet
              </p>
            )}
          </div>

          <CompanyActions slug={companySlug} />

          {profile?.hasMetadata && <CompanyOverview profile={profile} />}

          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
            <p className="text-ink-soft mb-1">No CandidateVoice hiring reports yet.</p>
            <p className="text-sm text-ink-muted mb-6">
              {profile?.hasMetadata
                ? "The facts above are public metadata. Be the first to reveal how this company actually hires."
                : "Be the first to reveal how this company hires."}
            </p>
            <Link
              href={`/submit?company=${encodeURIComponent(companySlug)}`}
              className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-6 py-3 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
            >
              Be the first to submit your experience →
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const metrics = calculateHQS(rows)!;
  // Same threshold that gates the headline score, applied to the breakdown too
  // so the page is consistent about what counts as enough evidence.
  const hasEnoughForBreakdown = metrics.total >= MIN_SUBMISSIONS_FOR_BREAKDOWN;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-14 w-full flex-1">

        {/* Header */}
        <div className="mb-8 pb-8 border-b border-rule">
          <h1 className="font-serif text-4xl text-ink capitalize mb-2">{displayName}</h1>
          <p className="text-xs font-mono uppercase tracking-wider text-ink-muted">
            Based on {metrics.total} anonymous {metrics.total === 1 ? "submission" : "submissions"}
          </p>
        </div>

        <CompanyActions slug={companySlug} />

        {profile?.hasMetadata && <CompanyOverview profile={profile} />}

        {/* HQS score */}
        <div className={`border ${hqsBorderColor(metrics.hqs)} bg-paper-sheet rounded-sm p-8 mb-8 shadow-sheet flex items-center justify-between gap-6`}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-2">
              Hiring Quality Score
            </p>
            {metrics.total >= 5 ? (
              <>
                <p className={`font-serif text-7xl leading-none tnum ${hqsColor(metrics.hqs)}`}>
                  {metrics.hqs}
                </p>
                <p className="text-xs text-ink-muted mt-2">out of 100</p>
              </>
            ) : (
              <>
                <p className="font-serif text-3xl text-ink-muted leading-none">Not enough data</p>
                <p className="text-xs text-ink-muted mt-2">Score available after {MIN_SUBMISSIONS_FOR_BREAKDOWN}+ submissions</p>
              </>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className={`inline-flex items-center border px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider font-medium ${confidenceBadge(metrics.confidence)}`}>
              {metrics.confidence} confidence
            </span>
            <p className="text-xs text-ink-faint mt-2 tnum">
              {metrics.total} {metrics.total === 1 ? "submission" : "submissions"}
            </p>
          </div>
        </div>

        {isUnlocked ? (
          hasEnoughForBreakdown ? (
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* Metrics */}
              <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
                <h2 className="font-serif text-lg text-ink mb-4">Breakdown</h2>
                <MetricRow label="Ghost Rate"           value={metrics.ghostRate} />
                <MetricRow label="Early Rejection Rate" value={metrics.earlyRejectRate} />
                <MetricRow label="Transparency Score"   value={metrics.transparencyRate} />
                <MetricRow label="Payment Risk"         value={metrics.paymentRate} />
                <MetricRow label="Response Speed Score" value={metrics.responseScore} suffix="" />
              </div>

              {/* Stage distribution */}
              <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
                <h2 className="font-serif text-lg text-ink mb-4">Stage distribution</h2>
                <StageBar data={rows} />
              </div>
            </div>
          ) : (
            /* Below the threshold the page previously suppressed the single
               headline score while still rendering five per-metric percentages
               derived from the same handful of reports — the caution was applied
               to one number and not to the five noisier ones beside it. With
               n=1 every metric is a bare 0% or 100%, which reads as a confident
               finding and, at that sample size, also exposes one person's
               individual answers. */
            <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-10 text-center mb-8">
              <p className="text-sm text-ink-soft mb-1">
                Breakdown available after {MIN_SUBMISSIONS_FOR_BREAKDOWN} reports.
              </p>
              <p className="text-xs text-ink-muted mb-6">
                {metrics.total === 1
                  ? "One report cannot show a pattern — every rate would read 0% or 100%."
                  : `${metrics.total} reports so far. Percentages from this few would imply precision the data does not have.`}
              </p>
              <Link
                href={`/submit?company=${encodeURIComponent(companySlug)}`}
                className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
              >
                Add your experience →
              </Link>
            </div>
          )
        ) : (
          <div className="space-y-6 mb-8">
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
              <h2 className="font-serif text-lg text-ink mb-3">Unlock full insights</h2>
              <ul className="text-sm text-ink-soft mb-4 space-y-1">
                <li>— Ghost rate</li>
                <li>— Rejection patterns</li>
                <li>— Screening quality</li>
              </ul>
              <p className="text-xs text-ink-muted mb-5">
                Submit your experience to unlock (2 mins, anonymous)
              </p>
              <Link
                href={`/submit?company=${encodeURIComponent(companySlug)}`}
                className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
              >
                Unlock insights →
              </Link>
            </div>

            {/* Placeholder only — real metric values are never sent to the client
                while locked, so this cannot be revealed with devtools. */}
            <div className="relative border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-6 select-none">
              <h2 className="font-serif text-lg text-ink-faint mb-4">Breakdown</h2>
              <div className="opacity-40 pointer-events-none">
                {["Ghost Rate", "Early Rejection Rate", "Transparency Score", "Payment Risk", "Response Speed Score"].map((label) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-rule last:border-0">
                    <span className="text-sm text-ink-soft">{label}</span>
                    <span className="font-mono text-sm text-ink-faint">—</span>
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="border border-rule-strong bg-paper px-3 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-muted">
                  Locked
                </span>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-faint text-center">
          {isUnlocked
            ? "Full insights unlocked for this company · All data is anonymized"
            : "Summary visible · Submit to unlock full insights"}
        </p>
      </main>
      <Footer />
    </div>
  );
}
