/**
 * Hiring timeline — read-only render of hiring_opportunities + their events
 * (migration 0022). Neutral canonical language only; every line is generated
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

export default function HiringTimeline({ opportunities }: { opportunities: PublicHiringOpportunity[] }) {
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
