import Link from "next/link";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadEvidence } from "@/lib/evidence";
import type { EvidenceItem } from "@/lib/evidence";
import { buildBehaviouralFingerprint, BEHAVIOURAL_DIMENSION_LABELS } from "@/lib/fingerprint/behavioural";
import type { BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";
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
  const firstPartyRaw = evidenceSet!.base.firstPartyRaw;
  const externalRaw = evidenceSet!.base.externalRaw;
  const firstPartyProportion = Math.round(evidenceSet!.base.firstPartyProportion * 100);

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

        {profile?.hasMetadata && <CompanyOverview profile={profile} />}

        {/* HQS headline */}
        <div className={`border ${hqs ? hqsBorderColor(hqs.score) : "border-rule"} bg-paper-sheet rounded-sm p-8 mb-8 shadow-sheet flex items-center justify-between gap-6`}>
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
          <div className="text-right shrink-0">
            <span className={`inline-flex items-center border px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider font-medium ${tierBadge(hqs?.tier ?? "insufficient")}`}>
              {hqs?.tier ?? "insufficient"} confidence
            </span>
            <p className="text-xs text-ink-faint mt-2 tnum">
              {firstPartyRaw} first-party · {externalRaw} external
            </p>
          </div>
        </div>

        {isUnlocked ? (
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

            {/* Stage distribution — kept as raw counts across families for M3;
                weighted-share treatment is M5's job. */}
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
              <h2 className="font-serif text-lg text-ink mb-4">Stage distribution</h2>
              <StageBar items={items} />
            </div>
          </div>
        ) : (
          <div className="space-y-6 mb-8">
            <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
              <h2 className="font-serif text-lg text-ink mb-3">Unlock full insights</h2>
              <ul className="text-sm text-ink-soft mb-4 space-y-1">
                {Object.values(BEHAVIOURAL_DIMENSION_LABELS).map((label) => (
                  <li key={label}>— {label}</li>
                ))}
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
