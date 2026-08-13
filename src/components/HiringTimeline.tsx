/**
 * Hiring timeline — read-only render of hiring_opportunities + their events
 * (migration 0023). Neutral canonical language only; every line is generated
 * from a structured event, never free text. Candidate perception is always
 * labelled as perception; a system inference is always visually and textually
 * marked as derived, never presented as an observed fact.
 *
 * Anonymity: consumes public_hiring_events (reported_month only, no exact
 * timestamps, no submission_id), same envelope as public_submissions.
 */

import type { PublicHiringOpportunity, PublicHiringEvent } from "@/lib/hiring-intent/timeline";
import { STALE_INFERENCE_TEXT } from "@/lib/hiring-intent/stale";
import type {
  CandidatePerceivedIntentPayload,
  InterviewOccurredPayload,
  CandidateOutcomePayload,
  CandidateFollowUpPayload,
} from "@/lib/hiring-intent/events";
import { hasAnyHiringAnalytics, type HiringAnalytics } from "@/lib/hiring-intent/analytics";
import type { MetricResult } from "@/lib/evidence";

/** One stat cell: a number (or an honest dash) plus its raw sample size —
 *  same "value + (N raw)" convention DimensionRow uses on this page. */
function Stat({ label, value, metric, suffix = "" }: { label: string; value: string | null; metric: MetricResult; suffix?: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-1">{label}</p>
      <p className="font-mono text-lg text-ink tnum">
        {value === null ? <span className="text-ink-faint text-sm">— {metric.suppressionReason === "insufficient_evidence" ? "not enough reports" : "no data yet"}</span> : `${value}${suffix}`}
      </p>
      {value !== null && <p className="text-[10px] text-ink-faint tnum">{metric.rawDenominator} {metric.rawDenominator === 1 ? "opportunity" : "opportunities"}</p>}
    </div>
  );
}

/**
 * Compact stats strip above the per-role timelines. Self-suppressing per cell
 * (D-002/D-003: null renders as an honest dash, never a fabricated number) and
 * as a whole (hasAnyHiringAnalytics gates the entire strip). HR-update
 * frequency will read "no data yet" until D-011 (org auth) unblocks it — that
 * is the correct, honest state, not a bug.
 */
function AnalyticsStrip({ analytics }: { analytics: HiringAnalytics }) {
  if (!hasAnyHiringAnalytics(analytics)) return null;
  const pct = (m: MetricResult) => (m.value === null ? null : Math.round(m.value * 100));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 pb-6 border-b border-rule">
      <Stat label="Time to resolution" value={analytics.timeToResolutionDays === null ? null : String(analytics.timeToResolutionDays)} metric={analytics.resolutionMetric} suffix=" days" />
      <Stat label="Stale-role rate" value={pct(analytics.staleRoleRate) === null ? null : String(pct(analytics.staleRoleRate))} metric={analytics.staleRoleRate} suffix="%" />
      <Stat label="Perception matched outcome" value={pct(analytics.perceptionAccuracy) === null ? null : String(pct(analytics.perceptionAccuracy))} metric={analytics.perceptionAccuracy} suffix="%" />
      <Stat label="HR update frequency" value={pct(analytics.hrUpdateFrequency) === null ? null : String(pct(analytics.hrUpdateFrequency))} metric={analytics.hrUpdateFrequency} suffix="%" />
    </div>
  );
}

const SERIOUSNESS_LABEL: Record<string, string> = {
  very_serious: "very serious",
  serious: "serious",
  neutral: "neutral / hard to tell",
  not_serious: "not very serious",
  very_not_serious: "not serious at all",
};

const STAGE_LABEL: Record<string, string> = {
  applied: "applied", screening: "screening", technical: "a technical round", hr: "an HR round", final: "a final round",
};

const OUTCOME_LABEL: Record<string, string> = {
  rejected: "was rejected", no_response: "received no response", offer: "received an offer", ongoing: "is still in process",
};

interface RenderedEvent {
  text: string;
  /** 'candidate' = perception/experience, 'system' = derived inference. Drives
   *  the visual distinction the design requires between observed and derived. */
  kind: "candidate" | "system";
  reportedMonth: string | null;
}

function renderEvent(e: PublicHiringEvent): RenderedEvent | null {
  switch (e.eventType) {
    case "role_reported":
      return { text: "A candidate reported this role.", kind: "candidate", reportedMonth: e.reportedMonth };
    case "interview_occurred": {
      const stage = (e.payload as InterviewOccurredPayload).stage;
      return { text: `A candidate reported reaching ${stage ? STAGE_LABEL[stage] ?? "an interview" : "an interview"}.`, kind: "candidate", reportedMonth: e.reportedMonth };
    }
    case "candidate_perceived_intent": {
      const p = e.payload as CandidatePerceivedIntentPayload;
      return { text: `A candidate perceived the company as ${SERIOUSNESS_LABEL[p.perceivedSeriousness] ?? "—"} about hiring.`, kind: "candidate", reportedMonth: e.reportedMonth };
    }
    case "candidate_outcome": {
      const o = (e.payload as CandidateOutcomePayload).outcome;
      return { text: `A candidate ${o ? OUTCOME_LABEL[o] ?? "reported an outcome" : "reported an outcome"}.`, kind: "candidate", reportedMonth: e.reportedMonth };
    }
    case "candidate_follow_up": {
      const gap = (e.payload as CandidateFollowUpPayload).lastContactGap;
      return { text: `A candidate reported their last contact was ${gap ?? "some time"} days ago.`, kind: "candidate", reportedMonth: e.reportedMonth };
    }
    case "system_stale_inference":
      return { text: STALE_INFERENCE_TEXT, kind: "system", reportedMonth: e.reportedMonth };
    default:
      return null;
  }
}

export default function HiringTimeline({
  opportunities,
  analytics,
}: {
  opportunities: PublicHiringOpportunity[];
  /** Optional — company-page callers pass the pre-computed reduction (no new
   *  query); omit entirely where analytics aren't relevant yet. */
  analytics?: HiringAnalytics;
}) {
  const withEvents = opportunities.filter((o) => o.events.length > 0);
  if (withEvents.length === 0) return null;

  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <h2 className="font-serif text-lg sm:text-xl text-ink mb-1">Hiring activity</h2>
      <p className="text-xs text-ink-muted mb-5">
        A timeline built from candidate reports for specific roles. Perceptions are one candidate&apos;s
        impression; a &ldquo;stale&rdquo; note is an inference from the available reports, not a statement
        about the company&apos;s intent.
      </p>
      {analytics && <AnalyticsStrip analytics={analytics} />}
      <div className="space-y-6">
        {withEvents.map((opp) => (
          <div key={opp.id}>
            <h3 className="text-sm font-medium text-ink capitalize mb-2">{opp.roleKey}</h3>
            <ol className="space-y-2 border-l border-rule pl-4">
              {opp.events.map((e) => {
                const r = renderEvent(e);
                if (!r) return null;
                return (
                  <li key={e.id} className="relative">
                    <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${r.kind === "system" ? "bg-warn" : "bg-accent"}`} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`text-sm ${r.kind === "system" ? "text-warn italic" : "text-ink-soft"}`}>
                        {r.kind === "system" && <span className="text-[10px] font-mono uppercase tracking-wider not-italic mr-1.5">Inference</span>}
                        {r.text}
                      </span>
                      {r.reportedMonth && <span className="text-[10px] font-mono text-ink-faint tnum shrink-0">{r.reportedMonth}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
