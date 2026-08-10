import Link from "next/link";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  loadEvidence,
  loadExternalDisplayRows,
  scopeToCohort,
  isEmptyCohort,
  describeCohort,
  parseExperienceBucket,
  parseApplicationChannel,
  EXPERIENCE_BUCKET_LABELS,
  APPLICATION_CHANNEL_LABELS,
} from "@/lib/evidence";
import type { EvidenceItem, ExternalReportDisplayRow, CohortFilter } from "@/lib/evidence";
import { buildBehaviouralFingerprint, BEHAVIOURAL_DIMENSION_LABELS } from "@/lib/fingerprint/behavioural";
import type { BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";
import { buildForecast, hasAnyForecast } from "@/lib/fingerprint/forecast";
import { buildCompensationProfile, computePrivacyScore } from "@/lib/fingerprint/compensation";
import type { CompensationProfile, PrivacyScoreResult } from "@/lib/fingerprint/compensation";
import { buildOffboardingProfile, computeExitIntegrityScore } from "@/lib/fingerprint/offboarding";
import type { OffboardingProfile, ExitIntegrityResult } from "@/lib/fingerprint/offboarding";
import { cultureSignal } from "@/lib/fingerprint/culture";
import type { CultureSignal } from "@/lib/fingerprint/culture";
import { conductSignal } from "@/lib/fingerprint/conduct";
import type { ConductSignal } from "@/lib/fingerprint/conduct";
import { buildActionPlan } from "@/lib/fingerprint/actions";
import type { ActionPlan, ActionTone } from "@/lib/fingerprint/actions";
import type { ForecastLine, ForecastTone } from "@/lib/fingerprint/forecast";
import { computeFit, explainFit } from "@/lib/advisor";
import { readCandidateVector, hasPreferences } from "@/lib/candidate/server";
import FitForYou from "@/components/advisor/FitForYou";
import { computeHqs, HQS_WEIGHTS, HQS_MIN_EFFECTIVE_N } from "@/utils/hqs";
import type { HqsResult, HqsTier } from "@/utils/hqs";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CompanyOverview, { CompanyActions } from "@/components/CompanyOverview";
import ProfileEnrichment from "@/components/ProfileEnrichment";
import Bar from "@/components/charts/Bar";
import HiringTimeline from "@/components/HiringTimeline";
import { loadHiringOpportunities, recordStaleInferenceIfDue } from "@/lib/hiring-intent/timeline";
import { loadCompanyProfile } from "@/lib/company-intelligence/read";
import { loadSimilarCompanies } from "@/lib/company-intelligence/similar";
import type { SimilarCompany } from "@/lib/company-intelligence/similar";
import {
  COOKIE_NAME,
  decodeUnlockedCompaniesCookie,
  normalizeCompanySlug,
} from "@/lib/unlock-cookie";

interface Props {
  params: { slug: string };
  /** Cohort filter, read from ?experience=&channel= — see CohortSelector below. */
  searchParams?: { experience?: string; channel?: string };
}

const COHORT_SELECT_CLS =
  "w-full bg-paper border border-rule text-ink-soft text-sm rounded-sm px-3 py-2 shadow-press focus:outline-none focus:border-accent transition-colors";

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
  const tone = dim.score === null ? "neutral" : dim.score >= 70 ? "good" : dim.score >= 40 ? "warn" : "bad";
  return (
    <div className="py-2.5 border-b border-rule last:border-0">
      <div className="flex items-center justify-between">
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
      <Bar value={dim.score} tone={tone} className="mt-1.5" />
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

/**
 * "Companies like this one" — the read-model graph (src/lib/company-intelligence/
 * similar.ts). Metadata-derived (shared industry / technology terms), so it can
 * render on a company with zero reports. Renders nothing when there is no
 * overlap — an honest empty, never a filler list.
 */
function SimilarCompanies({ rows }: { rows: SimilarCompany[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet mb-8">
      <h2 className="font-serif text-lg text-ink mb-1">Similar companies</h2>
      <p className="text-xs text-ink-muted mb-4">By shared industry — a starting point for alternatives to compare.</p>
      <div className="flex flex-wrap gap-2.5">
        {rows.map((r) => (
          <Link
            key={r.organizationId}
            href={`/company/${encodeURIComponent(r.slug)}`}
            className="group border border-rule-strong bg-paper rounded-sm px-3 py-2 hover:border-ink-faint transition-colors"
          >
            <span className="text-sm text-ink-soft group-hover:text-ink capitalize">{r.displayName}</span>
            <span className="block text-[10px] text-ink-faint mt-0.5">{r.sharedTerms.slice(0, 3).join(" · ")}</span>
          </Link>
        ))}
      </div>
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
function ForecastPanel({
  lines,
  rawTotal,
  tier,
  title = "What to expect if you apply",
  subtitle,
}: {
  lines: ForecastLine[];
  rawTotal: number;
  tier: HqsTier;
  title?: string;
  /** Overrides the default "what happened to N people" line — used by the
   *  cohort panel to name the cohort instead of the whole company. */
  subtitle?: string;
}) {
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-xl sm:text-2xl text-ink">{title}</h2>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-muted">
          {tier} confidence
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-6">
        {subtitle ?? `What actually happened to ${rawTotal} ${rawTotal === 1 ? "person" : "people"} who reported on this company.`}
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

/**
 * Compensation Transparency & Privacy. Renders only when at least one
 * dimension survived suppression — an empty panel would imply we looked and
 * found nothing, when in fact nobody has reported yet.
 *
 * Copy is deliberately jurisdiction-neutral: salary-history rules vary by
 * country and state, so we report what companies DID and never say what is
 * illegal. "No range shared" is an observation; it is never "refused".
 */
function CompensationPanel({ profile, score }: { profile: CompensationProfile; score: PrivacyScoreResult | null }) {
  const shown = profile.dimensions.filter((d) => !d.suppressed && d.score !== null);
  if (shown.length === 0) return null;
  const tone = score === null ? "text-ink" : score.tier === "strong" ? "text-good" : score.tier === "mixed" ? "text-warn" : "text-bad";
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-lg sm:text-xl text-ink">Pay transparency &amp; privacy</h2>
        {score && (
          <span className={`font-serif text-2xl tnum ${tone}`}>
            {score.score}<span className="text-xs text-ink-faint font-sans">/100</span>
          </span>
        )}
      </div>
      <p className="text-xs text-ink-muted mb-5">
        What candidates reported about salary questions and document requests. Higher is more privacy-respecting.
      </p>
      <div className="space-y-3">
        {shown.map((d) => (
          <div key={d.key} className="py-1 border-b border-rule last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-soft">{d.label}</span>
              <span className="text-right shrink-0">
                <span className="font-mono text-sm text-ink tnum">{Math.round(d.score!)}</span>
                <span className="block text-[10px] font-mono text-ink-faint tnum">
                  {d.metric.rawNumerator} of {d.metric.rawDenominator} reports
                </span>
              </span>
            </div>
            <Bar value={d.score} tone={d.score! >= 70 ? "good" : d.score! >= 40 ? "warn" : "bad"} className="mt-1.5 mb-2" />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-4 leading-relaxed">
        Salary-history rules vary by jurisdiction — restricted in some, lawful in others.
        CandidateVoice reports what companies did, and does not give legal advice.
        Reports where a candidate skipped a question are excluded, never counted as a &ldquo;no&rdquo;.
      </p>
    </section>
  );
}

/**
 * Exit Integrity — what happens when someone leaves. Self-suppressing like
 * CompensationPanel: nothing renders until a dimension clears its floor, from
 * leaver reports only (offboarding.ts's own describeBase).
 */
function OffboardingPanel({ profile, score }: { profile: OffboardingProfile; score: ExitIntegrityResult | null }) {
  const shown = profile.dimensions.filter((d) => !d.suppressed && d.score !== null);
  if (shown.length === 0) return null;
  const tone = score === null ? "text-ink" : score.tier === "clean" ? "text-good" : score.tier === "mixed" ? "text-warn" : "text-bad";
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-lg sm:text-xl text-ink">Exit integrity</h2>
        {score && (
          <span className={`font-serif text-2xl tnum ${tone}`}>
            {score.score}<span className="text-xs text-ink-faint font-sans">/100</span>
          </span>
        )}
      </div>
      <p className="text-xs text-ink-muted mb-5">
        What people who left reported about their experience letter, final settlement, and documentation.
      </p>
      <div className="space-y-3">
        {shown.map((d) => (
          <div key={d.key} className="py-1 border-b border-rule last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-soft">{d.label}</span>
              <span className="text-right shrink-0">
                <span className="font-mono text-sm text-ink tnum">{Math.round(d.score!)}</span>
                <span className="block text-[10px] font-mono text-ink-faint tnum">
                  {d.metric.rawNumerator} of {d.metric.rawDenominator} reports
                </span>
              </span>
            </div>
            <Bar value={d.score} tone={d.score! >= 70 ? "good" : d.score! >= 40 ? "warn" : "bad"} className="mt-1.5 mb-2" />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-4 leading-relaxed">
        From former employees only. A delay or gap is reported as what happened, not as an
        accusation of intent — CandidateVoice does not know why a document or payment was late.
      </p>
    </section>
  );
}

/**
 * Culture — the "would you recommend" headline, from people who worked there.
 * Self-suppressing below culture.ts's own (higher) anonymity floor.
 */
function CulturePanel({ signal }: { signal: CultureSignal | null }) {
  if (!signal) return null;
  const tone = signal.recommendScore >= 70 ? "text-good" : signal.recommendScore >= 40 ? "text-warn" : "text-bad";
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-lg sm:text-xl text-ink">Would employees recommend it?</h2>
        <span className={`font-serif text-2xl tnum ${tone}`}>
          {signal.recommendScore}<span className="text-xs text-ink-faint font-sans">/100</span>
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-4">
        From people who currently or previously worked there · {signal.total} reports.
      </p>
      <div className="flex gap-4 text-xs font-mono tnum text-ink-soft">
        <span>{signal.counts.yes} yes</span>
        <span>{signal.counts.maybe} maybe</span>
        <span>{signal.counts.no} no</span>
      </div>
    </section>
  );
}

/**
 * Workplace Conduct — the sharpest panel in the product. Renders ONLY an
 * aggregate prevalence, from conduct.ts, which is ALREADY the anonymity gate
 * (CONDUCT_MIN_EFFECTIVE_N=8) — this component adds no further logic, only the
 * mandatory framing. Never names anyone; never asserts cause; never appears as
 * a company "grade". See conduct.ts's header for the full rationale and the
 * documented precondition for raising this surface's prominence.
 */
function ConductPanel({ signal }: { signal: ConductSignal | null }) {
  if (!signal) return null;
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <h2 className="font-serif text-lg sm:text-xl text-ink mb-1">Workplace conduct</h2>
      <p className="text-xs text-ink-muted mb-4">
        How employees and former employees described the day-to-day environment · {signal.total} reports.
      </p>
      <div className="space-y-2 text-sm text-ink-soft">
        <div className="flex items-baseline justify-between py-1.5 border-b border-rule">
          <span>Respectful / mostly okay</span>
          <span className="font-mono tnum text-ink">{Math.round(signal.respectfulShare * 100)}%</span>
        </div>
        <div className="flex items-baseline justify-between py-1.5 border-b border-rule last:border-0">
          <span>Some or serious concerns</span>
          <span className="font-mono tnum text-ink">{Math.round(signal.concernShare * 100)}%</span>
        </div>
      </div>
      <p className="text-[10px] text-ink-faint mt-4 leading-relaxed">
        This is an aggregated, anonymous self-report from {signal.total} people — not an
        adjudication of any claim, and not a substitute for a formal grievance process.
        CandidateVoice never names an individual and never asserts what caused a reported
        environment. If you are experiencing workplace harassment, please use your employer&apos;s
        formal grievance channel or applicable local authority.
      </p>
    </section>
  );
}

const ACTION_TONE: Record<ActionTone, { dot: string; text: string }> = {
  risk: { dot: "bg-bad", text: "text-bad" },
  caution: { dot: "bg-warn", text: "text-warn" },
  positive: { dot: "bg-good", text: "text-good" },
};

const VERDICT_CLS: Record<ActionPlan["verdict"], string> = {
  apply: "border-[#C5DBCC] bg-[#E8F0EA] text-good",
  apply_with_caution: "border-[#E3D4AE] bg-[#F4EEDD] text-warn",
  insufficient: "border-rule-strong bg-paper-sunk text-ink-muted",
};

const VERDICT_LABEL: Record<ActionPlan["verdict"], string> = {
  apply: "Worth applying",
  apply_with_caution: "Apply with caution",
  insufficient: "Not enough data",
};

/**
 * Action Engine surface — the DECISION over the fingerprint (verdict + grounded
 * flags), sitting right under the Forecast ("what to expect"). Every flag
 * carries the metric that produced it; nothing here is generated. Renders even
 * on an insufficient verdict — the honest "we can't call it yet" is itself the
 * action a reader needs.
 */
function ActionPanel({ plan }: { plan: ActionPlan }) {
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <span className={`inline-flex items-center border px-3 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider font-medium ${VERDICT_CLS[plan.verdict]}`}>
          {VERDICT_LABEL[plan.verdict]}
        </span>
        <h2 className="font-serif text-lg sm:text-xl text-ink">Should you apply?</h2>
      </div>
      <p className="text-sm text-ink-soft mb-5 leading-relaxed">{plan.headline}</p>

      {plan.items.length > 0 && (
        <ul className="space-y-2.5">
          {plan.items.map((it) => (
            <li key={it.key} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${ACTION_TONE[it.tone].dot}`} aria-hidden />
              <span className="min-w-0">
                <span className={`text-sm font-medium ${ACTION_TONE[it.tone].text}`}>{it.label}</span>
                <span className="block text-xs text-ink-muted">{it.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The "Evidence Match" cohort selector — the honest alternative to an ATS
 * score. No resume upload, no invented weights: the candidate names two true
 * facts about themselves and sees the REAL forecast for reports matching
 * both. A plain GET form — no client JS, the browser just re-navigates with
 * query params, matching this page's server-component-first architecture.
 */
function CohortSelector({ companySlug, filter }: { companySlug: string; filter: CohortFilter }) {
  const active = !isEmptyCohort(filter);
  return (
    <div className="border border-rule bg-paper-sheet rounded-sm p-5 sm:p-6 mb-8 shadow-sheet">
      <h2 className="font-serif text-base sm:text-lg text-ink mb-1">Compare to reports like you</h2>
      <p className="text-xs text-ink-muted mb-4">
        See the forecast for people with your experience and application channel — from real reports, not a resume score.
      </p>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="experience-filter" className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-1.5">
            Your experience
          </label>
          {/* `key` is load-bearing, not cosmetic. These selects are uncontrolled
              (defaultValue), and "Clear" is a next/link to the SAME route — only
              searchParams change, so React reconciles these DOM nodes in place
              rather than remounting, and defaultValue is only ever applied at
              mount. Without a key tied to the filter value the dropdown keeps
              showing the cleared selection, and the next Compare silently
              resubmits the stale cohort. */}
          <select
            key={`experience-${filter.experienceBucket ?? "none"}`}
            id="experience-filter"
            name="experience"
            defaultValue={filter.experienceBucket ?? ""}
            className={COHORT_SELECT_CLS}
          >
            <option value="">Everyone</option>
            {Object.entries(EXPERIENCE_BUCKET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="channel-filter" className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-1.5">
            How you&apos;d apply
          </label>
          <select
            key={`channel-${filter.applicationChannel ?? "none"}`}
            id="channel-filter"
            name="channel"
            defaultValue={filter.applicationChannel ?? ""}
            className={COHORT_SELECT_CLS}
          >
            <option value="">Any</option>
            {Object.entries(APPLICATION_CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bg-accent text-paper-sheet px-4 py-2 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors shrink-0"
        >
          Compare →
        </button>
        {active && (
          <Link
            href={`/company/${encodeURIComponent(companySlug)}`}
            className="text-xs text-ink-muted hover:text-ink underline shrink-0 pb-2.5"
          >
            Clear
          </Link>
        )}
      </form>
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

export default async function CompanyPage({ params, searchParams }: Props) {
  const companySlug = normalizeCompanySlug(decodeURIComponent(params.slug));
  const cohortFilter: CohortFilter = {
    experienceBucket: parseExperienceBucket(searchParams?.experience),
    applicationChannel: parseApplicationChannel(searchParams?.channel),
  };
  const cohortActive = !isEmptyCohort(cohortFilter);
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

  // "Companies like this one" — metadata-derived (shared industry/tech terms),
  // so it works even with zero reports. Only queried when the org resolved to a
  // profile; degrades to [] on any error (never blocks the page).
  const similar: SimilarCompany[] = profile?.organizationId
    ? await loadSimilarCompanies(supabase as unknown as SupabaseClient, profile.organizationId).catch(() => [])
    : [];

  // Hiring-intent timeline (migration 0023) — read-only, and deliberately
  // INDEPENDENT of the evidence gate below: hiring_opportunities/hiring_events
  // can exist for a company with zero approved hiring_submissions (candidate
  // reports awaiting moderation still emit events), so this must be computed
  // before the rawTotal===0 early return, not after it — a company with a
  // pending-moderation candidate report should still show its hiring timeline.
  //
  // This is also the deliberately "opportunistic" staleness path: no
  // scheduler exists, so any opportunity past its deadline gets its
  // system_stale_inference event recorded here, on read, then the timeline is
  // re-read so the new inference shows immediately. Isolated from evidence
  // entirely — a failure here is swallowed and never affects the
  // fingerprint/HQS/forecast built further down.
  let hiringOpportunities: Awaited<ReturnType<typeof loadHiringOpportunities>> = [];
  if (profile?.organizationId) {
    try {
      hiringOpportunities = await loadHiringOpportunities(supabase as unknown as SupabaseClient, profile.organizationId);
      const due = hiringOpportunities.filter(
        (o) => new Date(o.observationDeadlineAt).getTime() < Date.now() && !o.events.some((e) => e.eventType === "system_stale_inference")
      );
      if (due.length > 0) {
        const admin = createAdminClient() as unknown as SupabaseClient;
        await Promise.all(due.map((o) => recordStaleInferenceIfDue(admin, o)));
        hiringOpportunities = await loadHiringOpportunities(supabase as unknown as SupabaseClient, profile.organizationId);
      }
    } catch {
      hiringOpportunities = [];
    }
  }

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

          {/* Org resolved but has no metadata yet → try to fetch a provisional
              public profile in the background, then refresh. Mounts ONLY when
              profile !== null (the org exists, so the enrich route's resolve
              guard will pass); an unresolved slug renders the empty state with
              no trigger. Renders nothing itself — the page you see is instant. */}
          {profile !== null && !profile.hasMetadata && <ProfileEnrichment slug={companySlug} />}

          {profile?.hasMetadata && <CompanyOverview profile={profile} />}

          <SimilarCompanies rows={similar} />

          {/* Self-suppressing — renders only when a pending-moderation candidate
              report already produced hiring-intent events. */}
          <HiringTimeline opportunities={hiringOpportunities} />

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
  // Compensation transparency & privacy (0018) — same engine, own reduction.
  const compensation = buildCompensationProfile(items);
  const privacyScore = computePrivacyScore(compensation);
  // Tenure stages (0020) — offboarding/culture/conduct, same engine again.
  const offboarding = buildOffboardingProfile(items);
  const exitIntegrity = computeExitIntegrityScore(offboarding);
  const culture = cultureSignal(items);
  const conduct = conductSignal(items);
  // The decision layer over the same fingerprint + HQS: verdict + grounded flags.
  const actionPlan = buildActionPlan(fingerprint, hqs, compensation, offboarding, conduct);

  // "Fit for you" — only when the visitor has saved priorities. Pure over the
  // fingerprint already built above, so a visitor with a preference vector pays
  // nothing extra in DB reads; one without pays nothing at all.
  const candidateVector = await readCandidateVector();
  const fitForYou = hasPreferences(candidateVector) ? computeFit(candidateVector, fingerprint) : null;
  const fitExplanation = fitForYou ? explainFit(fitForYou, displayName) : null;
  const firstPartyRaw = evidenceSet!.base.firstPartyRaw;
  const externalRaw = evidenceSet!.base.externalRaw;
  const firstPartyProportion = Math.round(evidenceSet!.base.firstPartyProportion * 100);

  // Cohort scoping ("Evidence Match") — zero new formulas: scopeToCohort just
  // re-runs describeBase on the filtered subset, so buildBehaviouralFingerprint
  // and buildForecast are the SAME functions called on fewer items. Suppression
  // and the sunset invariant fall out for free rather than needing separate handling.
  const cohortSet = cohortActive ? scopeToCohort(evidenceSet!, cohortFilter) : null;
  const cohortFingerprint = cohortSet ? buildBehaviouralFingerprint(cohortSet) : null;
  const cohortForecastLines = cohortFingerprint ? buildForecast(cohortFingerprint, cohortSet!.items) : null;
  const cohortForecastAvailable = cohortForecastLines ? hasAnyForecast(cohortForecastLines) : false;
  const cohortHqs = cohortFingerprint ? computeHqs(cohortFingerprint) : null;
  const cohortDescription = describeCohort(cohortFilter);

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

        {/* The decision layer over the forecast: verdict + grounded action flags.
            Shown whenever the forecast is — a verdict without the "what to expect"
            behind it would be an unsupported claim. */}
        {forecastAvailable && <ActionPanel plan={actionPlan} />}

        {/* Pay transparency & privacy — self-suppressing: renders nothing until
            at least one dimension clears its floor. */}
        <CompensationPanel profile={compensation} score={privacyScore} />

        {/* Tenure-stage panels (0020) — from employees and former employees,
            each self-suppressing below its own floor. Ordered safest-first. */}
        <OffboardingPanel profile={offboarding} score={exitIntegrity} />
        <CulturePanel signal={culture} />
        <ConductPanel signal={conduct} />

        {/* Hiring activity timeline (0023) — self-suppressing: renders nothing
            until at least one opportunity has events. */}
        <HiringTimeline opportunities={hiringOpportunities} />

        {/* Personalised answer, when the visitor has set priorities. */}
        {fitForYou && fitExplanation && (
          <FitForYou fit={fitForYou} explanation={fitExplanation} displayName={displayName} />
        )}

        {/* Evidence Match: the honest alternative to an ATS score. Public, same
            as the forecast above — a candidate deciding whether to apply has
            nothing to trade yet, so this cannot sit behind the unlock gate. */}
        <CohortSelector companySlug={companySlug} filter={cohortFilter} />
        {cohortActive && cohortForecastLines && (
          cohortForecastAvailable ? (
            <ForecastPanel
              lines={cohortForecastLines}
              rawTotal={cohortSet!.base.rawTotal}
              tier={cohortHqs?.tier ?? "insufficient"}
              title="What to expect — people like you"
              subtitle={`What happened to ${cohortSet!.base.rawTotal} ${cohortSet!.base.rawTotal === 1 ? "person" : "people"} matching ${cohortDescription}.`}
            />
          ) : (
            <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-8 text-center mb-8">
              <p className="text-sm text-ink-soft mb-1">No reports match {cohortDescription} yet.</p>
              <p className="text-xs text-ink-muted">Try a broader filter, or check back as more reports come in.</p>
            </div>
          )
        )}

        {/* HQS headline. ALWAYS company-wide: `hqs` is computed from the full
            evidence set above, never from `cohortFingerprint`. When a cohort
            filter is active the panel directly above IS cohort-scoped, so this
            card must say plainly that it is not — otherwise a visitor reads a
            company-wide score as describing their cohort. Both numbers stay
            visible; only the scope is disambiguated. */}
        <div className={`border ${hqs ? hqsBorderColor(hqs.score) : "border-rule"} bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet flex flex-wrap items-center justify-between gap-6`}>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-2">
              Hiring Quality Score
              {cohortActive && <span className="text-ink-faint"> · all reports</span>}
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

        <SimilarCompanies rows={similar} />

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
