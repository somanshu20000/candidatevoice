import Link from "next/link";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadEvidence, loadExternalDisplayRows } from "@/lib/evidence";
import type { EvidenceItem, ExternalReportDisplayRow } from "@/lib/evidence";
import { buildBehaviouralFingerprint, BEHAVIOURAL_DIMENSION_LABELS } from "@/lib/fingerprint/behavioural";
import type { BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";
import { buildForecast, hasAnyForecast } from "@/lib/fingerprint/forecast";
import type { ForecastLine, ForecastTone } from "@/lib/fingerprint/forecast";
import { computeHqs, HQS_WEIGHTS, HQS_MIN_EFFECTIVE_N } from "@/utils/hqs";
import type { HqsResult, HqsTier } from "@/utils/hqs";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CompanyOverview, { CompanyActions } from "@/components/CompanyOverview";
import { loadCompanyProfile } from "@/lib/company-intelligence/read";
import {
  COOKIE_NAME,
  decodeUnlockedCompaniesCookie,
  normalizeCompanySlug,
} from "@/lib/unlock-cookie";

interface Props {
  params: { slug: string };
}

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

function tierBadge(tier: HqsTier) {
  const cfg: Record<HqsTier, string> = {
    high:         "bg-[#E8F0EA] text-good border-[#C5DBCC]",
    medium:       "bg-[#F4EEDD] text-warn border-[#E3D4AE]",
    low:          "bg-paper-sunk text-ink-muted border-rule-strong",
    insufficient: "bg-paper-sunk text-ink-muted border-rule-strong",
  };
  return cfg[tier];
}

function DimensionRow({ dim }: { dim: BehaviouralDimensionScore }) {
  const inHqs = HQS_WEIGHTS[dim.key] > 0;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-rule last:border-0">
      <span className="text-sm text-ink-soft">
        {dim.label}
        {!inHqs && <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint">not in HQS</span>}
      </span>
      <span className="font-mono text-sm font-medium text-ink tnum">
        {dim.score === null
          ? <span className="text-ink-faint">— {dim.suppressionReason ?? "no data"}</span>
          : <>
              {Math.round(dim.score)}
              <span className="ml-2 text-[10px] text-ink-faint">
                ({dim.metric.rawDenominator} raw)
              </span>
            </>}
      </span>
    </div>
  );
}

function StageBar({ items }: { items: EvidenceItem[] }) {
  const stages = Object.keys(STAGE_LABELS);
  const withStage = items.filter((i) => i.stage !== null);
  const total = withStage.length;
  if (total === 0) return null;
  const counts = stages
    .map((s) => ({ stage: s, label: STAGE_LABELS[s], count: withStage.filter((i) => i.stage === s).length }))
    .filter((x) => x.count > 0);

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

const OUTCOME_LABELS: Record<string, string> = {
  rejected: "Rejected", no_response: "No response", offer: "Offer", ongoing: "Ongoing",
};

function EvidenceMix({ firstPartyProportion, firstPartyRaw, externalRaw }: { firstPartyProportion: number; firstPartyRaw: number; externalRaw: number }) {
  // Only worth rendering the split when there IS external evidence — otherwise
  // "100% first-party" is noise on a page that's entirely first-party anyway.
  if (externalRaw === 0) return null;
  const externalProportion = 100 - firstPartyProportion;
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet mb-8">
      <h2 className="font-serif text-lg text-ink mb-3">Evidence mix</h2>
      <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-paper-sunk">
        <div className="bg-accent h-full" style={{ width: `${firstPartyProportion}%` }} />
        <div className="bg-ink-faint h-full" style={{ width: `${externalProportion}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span>{firstPartyProportion}% first-party · {firstPartyRaw} {firstPartyRaw === 1 ? "report" : "reports"}</span>
        <span>{externalProportion}% external · {externalRaw} {externalRaw === 1 ? "report" : "reports"}</span>
      </div>
      <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
        Shares are by evidence <em>weight</em>, not raw count — external reports count for less,
        so their share here is smaller than their report count alone would suggest.
      </p>
    </div>
  );
}

function ExternalReports({ rows }: { rows: ExternalReportDisplayRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border border-dashed border-rule-strong bg-paper-sunk rounded-sm p-6 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-serif text-lg text-ink">External reports</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-muted border border-rule-strong rounded-full px-2 py-0.5">
          unverified
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        Sourced from public third-party discussions. Structured facts only — never the original text.
        Counts for less than a first-party report and is shown separately.
      </p>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-rule last:border-0">
            <div className="min-w-0">
              <span className="text-sm text-ink-soft">
                {r.outcome ? OUTCOME_LABELS[r.outcome] ?? r.outcome : "Report"}
                {r.role && <span className="text-ink-muted"> · {r.role}</span>}
              </span>
              {r.reportedMonth && <span className="ml-2 text-[10px] font-mono text-ink-faint tnum">{r.reportedMonth}</span>}
            </div>
            <a
              href={r.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs text-accent hover:text-accent-hover shrink-0 whitespace-nowrap"
            >
              {r.sourceName} ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

const FORECAST_TONE_CLS: Record<ForecastTone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  neutral: "text-ink",
};

/**
 * The Interview Forecast — the page's reason to exist.
 *
 * Deliberately PUBLIC (outside the unlock gate). The give-to-get loop still
 * guards the per-dimension mechanics and the external source list below, but
 * the headline answer to "what will happen to me if I apply here" cannot be
 * the thing we withhold: a visitor who has not interviewed anywhere yet has
 * nothing to trade, and a link nobody can read is a link nobody shares.
 */
function ForecastPanel({ lines, rawTotal, tier }: { lines: ForecastLine[]; rawTotal: number; tier: HqsTier }) {
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-xl sm:text-2xl text-ink">What to expect if you apply</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">
          {tier} confidence
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-6">
        What actually happened to {rawTotal} {rawTotal === 1 ? "person" : "people"} who reported on this company.
      </p>

      <div className="grid sm:grid-cols-2 gap-x-8">
        {lines.map((line) => (
          <div
            key={line.key}
            className="flex items-baseline justify-between gap-3 py-3 border-b border-rule last:border-0 sm:[&:nth-last-child(2)]:border-0"
          >
            <span className="text-sm text-ink-soft">{line.label}</span>
            {line.value === null ? (
              <span className="text-xs text-ink-faint text-right shrink-0">{line.unavailableReason}</span>
            ) : (
              <span className="text-right shrink-0">
                <span className={`font-serif text-2xl tnum ${FORECAST_TONE_CLS[line.tone]}`}>
                  {line.value}
                </span>
                <span className="block text-[10px] font-mono text-ink-faint tnum">{line.basis}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function HqsHeadline({ hqs, rawTotal, effectiveN }: { hqs: HqsResult; rawTotal: number; effectiveN: number }) {
  const lower = Math.round(hqs.interval.lower);
  const upper = Math.round(hqs.interval.upper);
  return (
    <>
      <p className={`font-serif text-7xl leading-none tnum ${hqsColor(hqs.score)}`}>
        {hqs.score}
      </p>
      <p className="text-xs text-ink-muted mt-2 tnum">
        {lower}–{upper} range · {effectiveN.toFixed(1)} effective of {rawTotal} reports
      </p>
    </>
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

  // Evidence via loadEvidence (M1) — the single auditable path from stored
  // rows to every user-facing number. Metadata via the separate subsystem,
  // structurally disjoint, so a metadata failure never blocks the evidence view.
  const [evidenceSet, profile] = await Promise.all([
    loadEvidence(supabase as unknown as SupabaseClient, companySlug).catch(() => null),
    loadCompanyProfile(supabase as unknown as SupabaseClient, companySlug).catch(() => null),
  ]);

  const items: EvidenceItem[] = evidenceSet?.items ?? [];
  const displayName = profile?.displayName ?? companyName;
  const rawTotal = items.length;
  const effectiveN = evidenceSet?.base.effectiveN ?? 0;

  // No evidence at all — the "seeded from imported metadata, no reports yet" state.
  if (rawTotal === 0) {
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

  const fingerprint = buildBehaviouralFingerprint(evidenceSet!);
  const hqs = computeHqs(fingerprint);
  const forecastLines = buildForecast(fingerprint, items);
  const forecastAvailable = hasAnyForecast(forecastLines);
  const firstPartyRaw = evidenceSet!.base.firstPartyRaw;
  const externalRaw = evidenceSet!.base.externalRaw;
  const firstPartyProportion = Math.round(evidenceSet!.base.firstPartyProportion * 100);

  // Display rows for the External section — only fetched when external
  // evidence actually exists, so the common all-first-party company pays
  // nothing. Failures return [] (the reader swallows them), never blocking.
  const externalDisplayRows: ExternalReportDisplayRow[] =
    externalRaw > 0
      ? await loadExternalDisplayRows(supabase as unknown as SupabaseClient, evidenceSet!.organizationId)
      : [];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-14 w-full flex-1">

        <div className="mb-8 pb-8 border-b border-rule">
          <h1 className="font-serif text-4xl text-ink capitalize mb-2">{displayName}</h1>
          <p className="text-xs font-mono uppercase tracking-wider text-ink-muted">
            {rawTotal} {rawTotal === 1 ? "report" : "reports"} · {firstPartyProportion}% first-party
            {externalRaw > 0 && ` · ${externalRaw} external`}
          </p>
        </div>

        <CompanyActions slug={companySlug} />

        {/* THE ANSWER, first and unlocked. Everything below is supporting evidence. */}
        {forecastAvailable && (
          <ForecastPanel lines={forecastLines} rawTotal={rawTotal} tier={hqs?.tier ?? "insufficient"} />
        )}

        {/* HQS headline — the one-number summary of the forecast above. */}
        <div className={`border ${hqs ? hqsBorderColor(hqs.score) : "border-rule"} bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet flex flex-wrap items-center justify-between gap-6`}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-2">
              Hiring Quality Score
            </p>
            {hqs ? (
              <HqsHeadline hqs={hqs} rawTotal={rawTotal} effectiveN={effectiveN} />
            ) : (
              <>
                <p className="font-serif text-3xl text-ink-muted leading-none">Not enough data</p>
                <p className="text-xs text-ink-muted mt-2 tnum">
                  {effectiveN.toFixed(1)} effective reports · need {HQS_MIN_EFFECTIVE_N}+
                </p>
              </>
            )}
          </div>
          <div className="sm:text-right shrink-0">
            <span className={`inline-flex items-center border px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider font-medium ${tierBadge(hqs?.tier ?? "insufficient")}`}>
              {hqs?.tier ?? "insufficient"} confidence
            </span>
            <p className="text-xs text-ink-faint mt-2 tnum">
              {firstPartyRaw} first-party · {externalRaw} external
            </p>
          </div>
        </div>

        {profile?.hasMetadata && <CompanyOverview profile={profile} />}

        {/* Evidence mix — only renders when external evidence exists. Shown
            regardless of unlock state: it's provenance, not the insight itself. */}
        <EvidenceMix
          firstPartyProportion={firstPartyProportion}
          firstPartyRaw={firstPartyRaw}
          externalRaw={externalRaw}
        />

        {isUnlocked ? (
          <>
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* Behavioural breakdown */}
              <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
                <h2 className="font-serif text-lg text-ink mb-4">Behavioural fingerprint</h2>
                {fingerprint.dimensions.map((d) => (
                  <DimensionRow key={d.key} dim={d} />
                ))}
                <p className="text-[10px] text-ink-faint mt-4 leading-relaxed">
                  Higher is always better. Suppressed dimensions have too little
                  supporting evidence to score honestly.
                </p>
              </div>

              {/* Stage distribution — raw counts across families. Weighted-share
                  is deferred to the analytics surfaces (M6). */}
              <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
                <h2 className="font-serif text-lg text-ink mb-4">Stage distribution</h2>
                <StageBar items={items} />
              </div>
            </div>

            {/* External reports — clearly labelled, source-linked, visually
                distinct (dashed border, sunk background). Part 6 non-negotiable. */}
            <ExternalReports rows={externalDisplayRows} />
          </>
        ) : (
          <div className="space-y-6 mb-8">
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
              <h2 className="font-serif text-lg text-ink mb-3">See how this was measured</h2>
              <ul className="text-sm text-ink-soft mb-4 space-y-1">
                <li>— Per-dimension scores and how much evidence backs each</li>
                <li>— How far candidates got, stage by stage</li>
                <li>— Every external source, with links to the original</li>
              </ul>
              <p className="text-xs text-ink-muted mb-5">
                Share your own experience to unlock (2 mins, anonymous)
              </p>
              <Link
                href={`/submit?company=${encodeURIComponent(companySlug)}`}
                className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-5 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
              >
                Unlock the breakdown →
              </Link>
            </div>

            <div className="relative border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-6 select-none">
              <h2 className="font-serif text-lg text-ink-faint mb-4">Behavioural fingerprint</h2>
              <div className="opacity-40 pointer-events-none">
                {Object.values(BEHAVIOURAL_DIMENSION_LABELS).map((label) => (
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
