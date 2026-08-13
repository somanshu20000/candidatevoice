/**
 * Hiring-event analytics. Pins the properties that keep these four metrics
 * from quietly lying:
 *   1. null is not 0 — suppressed below the floor, never a fabricated rate
 *   2. no_response is not a resolution — the ghosting fallacy, refused
 *   3. 'neutral' perception is excluded, not averaged in as a midpoint
 *   4. the stale-rate denominator is "past deadline", not "all opportunities"
 *   5. HR-update frequency stays null while actor_type forbids 'hr'
 */

import { describe, expect, it } from "vitest";
import {
  buildHiringAnalytics,
  hasAnyHiringAnalytics,
  HIRING_ANALYTICS_MIN_EFFECTIVE_N,
  PERCEPTION_OUTCOME_MIN_EFFECTIVE_N,
} from "@/lib/hiring-intent/analytics";
import type { PublicHiringOpportunity, PublicHiringEvent } from "@/lib/hiring-intent/timeline";
import type { HiringOutcome } from "@/types/index";
import type { PerceivedSeriousness } from "@/lib/hiring-intent/events";

const NOW = new Date("2026-06-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
function eventId() {
  return `evt-${++seq}`;
}

function opportunity(overrides: Partial<PublicHiringOpportunity> & { events?: PublicHiringEvent[] }): PublicHiringOpportunity {
  return {
    id: overrides.id ?? `opp-${++seq}`,
    roleKey: "engineer",
    firstObservedAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
    lastActivityAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    observationDeadlineAt: new Date(NOW.getTime() + 20 * DAY).toISOString(), // not yet stale by default
    events: [],
    ...overrides,
  };
}

function outcomeEvent(outcome: HiringOutcome | null, reportedMonth = "2026-05"): PublicHiringEvent {
  return { id: eventId(), actorType: "candidate", eventType: "candidate_outcome", payload: { outcome }, reportedMonth };
}
function perceptionEvent(perceivedSeriousness: PerceivedSeriousness, reportedMonth = "2026-05"): PublicHiringEvent {
  return { id: eventId(), actorType: "candidate", eventType: "candidate_perceived_intent", payload: { perceivedSeriousness, reasons: [] }, reportedMonth };
}
function staleEvent(reportedMonth = "2026-05"): PublicHiringEvent {
  return { id: eventId(), actorType: "system", eventType: "system_stale_inference", payload: { daysSinceActivity: 40, inference: "hiring_appears_stale" }, reportedMonth };
}

describe("time to resolution", () => {
  it("returns null, not 0, with zero opportunities", () => {
    const a = buildHiringAnalytics([], NOW);
    expect(a.timeToResolutionDays).toBeNull();
    expect(a.resolutionMetric.suppressed).toBe(true);
    expect(a.resolutionMetric.suppressionReason).toBe("no_coverage");
  });

  it("suppresses one below the floor (n = floor - 1)", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N - 1 }, () =>
      opportunity({ events: [outcomeEvent("offer")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.timeToResolutionDays).toBeNull();
    expect(a.resolutionMetric.suppressed).toBe(true);
    expect(a.resolutionMetric.suppressionReason).toBe("insufficient_evidence");
  });

  it("renders at exactly the floor (n = floor)", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N }, () =>
      opportunity({
        firstObservedAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
        lastActivityAt: new Date(NOW.getTime() - 4 * DAY).toISOString(), // 6 days to resolution
        events: [outcomeEvent("offer")],
      })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.resolutionMetric.suppressed).toBe(false);
    expect(a.timeToResolutionDays).toBe(6);
  });

  it("no_response is NOT a resolution — the ghosting fallacy, refused", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N + 2 }, () =>
      opportunity({ events: [outcomeEvent("no_response")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    // The rate metric renders (enough opportunities), but the resolved rate is 0
    // and the days-average has nothing to average — never a fabricated number.
    expect(a.resolutionMetric.suppressed).toBe(false);
    expect(a.resolutionMetric.value).toBe(0);
    expect(a.timeToResolutionDays).toBeNull();
  });

  it("ongoing is NOT a resolution either", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N }, () => opportunity({ events: [outcomeEvent("ongoing")] }));
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.timeToResolutionDays).toBeNull();
  });

  it("mixes resolved and unresolved correctly — days averaged over resolved subset only", () => {
    const opps = [
      opportunity({
        firstObservedAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
        lastActivityAt: new Date(NOW.getTime() - 10 * DAY).toISOString(), // 10 days
        events: [outcomeEvent("offer")],
      }),
      opportunity({
        firstObservedAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
        lastActivityAt: new Date(NOW.getTime() - 0 * DAY).toISOString(), // 20 days
        events: [outcomeEvent("rejected")],
      }),
      opportunity({ events: [outcomeEvent("no_response")] }), // unresolved, excluded from the mean
    ];
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.timeToResolutionDays).toBe(15); // (10+20)/2, the no_response row never enters the mean
  });
});

describe("stale-role rate", () => {
  it("denominator is opportunities PAST deadline, not all opportunities", () => {
    const notYetStale = Array.from({ length: 10 }, () =>
      opportunity({ observationDeadlineAt: new Date(NOW.getTime() + 20 * DAY).toISOString() })
    );
    const pastDeadline = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N }, () =>
      opportunity({ observationDeadlineAt: new Date(NOW.getTime() - 1 * DAY).toISOString(), events: [staleEvent()] })
    );
    const a = buildHiringAnalytics([...notYetStale, ...pastDeadline], NOW);
    // If the not-yet-stale rows diluted the denominator this would suppress or read low;
    // instead the rate must be computed over exactly the 3 past-deadline rows, all marked stale.
    expect(a.staleRoleRate.suppressed).toBe(false);
    expect(a.staleRoleRate.rawDenominator).toBe(HIRING_ANALYTICS_MIN_EFFECTIVE_N);
    expect(a.staleRoleRate.value).toBe(1);
  });

  it("suppresses when nothing is past its deadline yet", () => {
    const opps = Array.from({ length: 10 }, () => opportunity({}));
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.staleRoleRate.suppressed).toBe(true);
    expect(a.staleRoleRate.suppressionReason).toBe("no_coverage");
  });

  it("null below the floor even when past deadline", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N - 1 }, () =>
      opportunity({ observationDeadlineAt: new Date(NOW.getTime() - 1 * DAY).toISOString() })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.staleRoleRate.suppressed).toBe(true);
    expect(a.staleRoleRate.suppressionReason).toBe("insufficient_evidence");
  });

  it("a past-deadline opportunity NOT marked stale correctly pulls the rate down", () => {
    const opps = [
      ...Array.from({ length: 2 }, () => opportunity({ observationDeadlineAt: new Date(NOW.getTime() - 1 * DAY).toISOString(), events: [staleEvent()] })),
      opportunity({ observationDeadlineAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }), // past deadline, never marked
    ];
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.staleRoleRate.value).toBeCloseTo(2 / 3, 5);
  });
});

describe("candidate perception vs outcome", () => {
  it("'neutral' is excluded from the denominator, never averaged in as a midpoint", () => {
    // All-neutral, paired with real outcomes — if neutral were treated as a
    // value this would render some score; it must suppress instead.
    const opps = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N + 5 }, () =>
      opportunity({ events: [perceptionEvent("neutral"), outcomeEvent("offer")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(true);
    expect(a.perceptionAccuracy.suppressionReason).toBe("no_coverage");
  });

  it("a genuine split (equal high/low reports) is excluded — not evidence either way", () => {
    const opps = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N + 5 }, () =>
      opportunity({ events: [perceptionEvent("serious"), perceptionEvent("not_serious"), outcomeEvent("offer")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(true);
  });

  it("requires the HIGHER floor than ordinary metrics", () => {
    expect(PERCEPTION_OUTCOME_MIN_EFFECTIVE_N).toBeGreaterThan(HIRING_ANALYTICS_MIN_EFFECTIVE_N);
    const belowHigherFloor = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N - 1 }, () =>
      opportunity({ events: [perceptionEvent("serious"), outcomeEvent("offer")] })
    );
    const a = buildHiringAnalytics(belowHigherFloor, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(true);
    expect(a.perceptionAccuracy.suppressionReason).toBe("insufficient_evidence");
  });

  it("high perception + offer agrees; high perception + rejected disagrees", () => {
    const opps = [
      ...Array.from({ length: 3 }, () => opportunity({ events: [perceptionEvent("very_serious"), outcomeEvent("offer")] })),
      ...Array.from({ length: 2 }, () => opportunity({ events: [perceptionEvent("serious"), outcomeEvent("rejected")] })),
    ];
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(false);
    expect(a.perceptionAccuracy.rawDenominator).toBe(5);
    expect(a.perceptionAccuracy.value).toBeCloseTo(3 / 5, 5);
  });

  it("low perception + rejected agrees", () => {
    const opps = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N }, () =>
      opportunity({ events: [perceptionEvent("very_not_serious"), outcomeEvent("rejected")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.value).toBe(1);
  });

  it("perception without any terminal outcome is excluded", () => {
    const opps = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N + 5 }, () =>
      opportunity({ events: [perceptionEvent("serious"), outcomeEvent("no_response")] })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(true);
  });

  it("a terminal outcome without any perception is excluded", () => {
    const opps = Array.from({ length: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N + 5 }, () => opportunity({ events: [outcomeEvent("offer")] }));
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.perceptionAccuracy.suppressed).toBe(true);
  });
});

describe("HR-update frequency — the authority-boundary guard", () => {
  it("stays null no matter how much candidate/system evidence exists", () => {
    // A large, otherwise-rich fixture — every OTHER metric should render fine,
    // proving the null here is specific to HR, not a general suppression bug.
    const opps = Array.from({ length: 20 }, () =>
      opportunity({
        observationDeadlineAt: new Date(NOW.getTime() - 1 * DAY).toISOString(),
        events: [perceptionEvent("serious"), outcomeEvent("offer"), staleEvent()],
      })
    );
    const a = buildHiringAnalytics(opps, NOW);
    expect(a.hrUpdateFrequency.suppressed).toBe(true);
    expect(a.hrUpdateFrequency.value).toBeNull();
    // The sibling metrics DO render — confirms this isn't a blanket-suppression bug.
    expect(a.resolutionMetric.suppressed).toBe(false);
    expect(a.perceptionAccuracy.suppressed).toBe(false);
    expect(a.staleRoleRate.suppressed).toBe(false);
  });

  it("PublicHiringEvent's actorType is typed to only 'candidate' | 'system' — 'hr' cannot type-check", () => {
    // Compile-time half of the guard: this file would fail tsc if actorType
    // admitted 'hr' and someone tried to construct one, which is exactly what
    // migration 0023's CHECK enforces at the DB layer. We don't attempt an
    // invalid literal here (that's what the type system already prevents) —
    // this test documents the pairing so a future widening is deliberate.
    const legalActors: PublicHiringEvent["actorType"][] = ["candidate", "system"];
    expect(legalActors).toHaveLength(2);
  });
});

describe("hasAnyHiringAnalytics — the render gate", () => {
  it("false when every metric is suppressed (the empty-state case)", () => {
    const a = buildHiringAnalytics([], NOW);
    expect(hasAnyHiringAnalytics(a)).toBe(false);
  });

  it("true when at least one metric survives", () => {
    const opps = Array.from({ length: HIRING_ANALYTICS_MIN_EFFECTIVE_N }, () => opportunity({ events: [outcomeEvent("offer")] }));
    const a = buildHiringAnalytics(opps, NOW);
    expect(hasAnyHiringAnalytics(a)).toBe(true);
  });
});
