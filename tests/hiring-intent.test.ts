/**
 * Hiring-intent — the pure functions: staleness inference, role-key
 * normalization, and candidate-event construction. I/O (findOrCreateOpportunity,
 * recordHiringEvents, loadHiringOpportunities) is verified live against
 * Supabase (see the implementation report), matching this codebase's existing
 * split between unit-tested pure logic and live-verified I/O.
 *
 * The two properties that matter most here:
 *   1. staleness is a DERIVED READ, never a stored fact that could go stale itself
 *   2. candidate events never fabricate a value the input didn't actually supply
 */

import { describe, expect, it } from "vitest";
import { computeStaleness, STALE_INFERENCE_TEXT, STALE_OBSERVATION_DAYS } from "@/lib/hiring-intent/stale";
import { normalizeRoleKey } from "@/lib/hiring-intent/match";
import { buildCandidateEvents, PERCEIVED_SERIOUSNESS_VALUES, INTENT_REASON_VALUES } from "@/lib/hiring-intent/events";

describe("computeStaleness", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("is not stale before the deadline", () => {
    const now = new Date("2026-01-30T00:00:00Z");
    const r = computeStaleness({ lastActivityAt: "2026-01-01T00:00:00Z", observationDeadlineAt: "2026-01-31T00:00:00Z" }, now);
    expect(r.stale).toBe(false);
  });

  it("is stale strictly after the deadline", () => {
    const now = new Date("2026-02-01T00:00:01Z");
    const r = computeStaleness({ lastActivityAt: "2026-01-01T00:00:00Z", observationDeadlineAt: "2026-01-31T00:00:00Z" }, now);
    expect(r.stale).toBe(true);
  });

  it("daysSinceActivity is computed from lastActivityAt, not the deadline", () => {
    const lastActivity = new Date("2026-01-01T00:00:00Z");
    const now = new Date(lastActivity.getTime() + 45 * DAY);
    const r = computeStaleness({ lastActivityAt: lastActivity.toISOString(), observationDeadlineAt: "2026-01-31T00:00:00Z" }, now);
    expect(r.daysSinceActivity).toBe(45);
  });

  it("never goes negative even if `now` is before lastActivityAt (clock skew)", () => {
    const r = computeStaleness({ lastActivityAt: "2026-06-01T00:00:00Z", observationDeadlineAt: "2026-07-01T00:00:00Z" }, new Date("2026-01-01T00:00:00Z"));
    expect(r.daysSinceActivity).toBe(0);
  });

  it("the window is 30 days and the wording never asserts intent", () => {
    expect(STALE_OBSERVATION_DAYS).toBe(30);
    expect(STALE_INFERENCE_TEXT.toLowerCase()).not.toContain("never intended");
    expect(STALE_INFERENCE_TEXT.toLowerCase()).not.toContain("refused");
    expect(STALE_INFERENCE_TEXT).toContain("appears stale");
    expect(STALE_INFERENCE_TEXT).toContain("evidence");
  });
});

describe("normalizeRoleKey", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeRoleKey("  Senior   Backend Engineer  ")).toBe("senior backend engineer");
  });

  it("two differently-cased/spaced inputs for the same role normalize identically", () => {
    expect(normalizeRoleKey("Backend Engineer")).toBe(normalizeRoleKey("backend   engineer"));
  });

  it("caps length at 200 (matches the DB constraint)", () => {
    const long = "x".repeat(500);
    expect(normalizeRoleKey(long).length).toBeLessThanOrEqual(200);
  });
});

describe("buildCandidateEvents — never fabricates, honors NULL is not NO", () => {
  const base = { submissionId: "sub-1", reportedMonth: "2026-08" };

  it("produces zero events when every field is unanswered", () => {
    const events = buildCandidateEvents({ stage: null, perceivedSeriousness: null, intentReasons: [], outcome: null, lastContactGap: null, ...base });
    expect(events).toHaveLength(0);
  });

  it("emits only the events for fields that were actually answered", () => {
    const events = buildCandidateEvents({
      stage: "final",
      perceivedSeriousness: null,
      intentReasons: [],
      outcome: "offer",
      lastContactGap: null,
      ...base,
    });
    expect(events.map((e) => e.eventType).sort()).toEqual(["candidate_outcome", "interview_occurred"]);
  });

  it("rejects an unrecognized value rather than passing it through", () => {
    const events = buildCandidateEvents({ stage: "not_a_real_stage", perceivedSeriousness: null, intentReasons: [], outcome: null, lastContactGap: null, ...base });
    expect(events).toHaveLength(0);
  });

  it("perceived intent carries only closed-enum reasons, silently dropping anything unrecognized", () => {
    const events = buildCandidateEvents({
      stage: null,
      perceivedSeriousness: "serious",
      intentReasons: ["recruiter_responsiveness", "made_up_reason", "vague_process"],
      outcome: null,
      lastContactGap: null,
      ...base,
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { perceivedSeriousness: string; reasons: string[] };
    expect(payload.reasons).toEqual(["recruiter_responsiveness", "vague_process"]);
    expect(PERCEIVED_SERIOUSNESS_VALUES).toContain(payload.perceivedSeriousness);
  });

  it("every event carries submissionId and reportedMonth for provenance/anonymity", () => {
    const events = buildCandidateEvents({ stage: "final", perceivedSeriousness: null, intentReasons: [], outcome: null, lastContactGap: null, ...base });
    expect(events[0].submissionId).toBe("sub-1");
    expect(events[0].reportedMonth).toBe("2026-08");
  });

  it("the reason vocabulary matches exactly what was specified — 9 structured reasons, no free text", () => {
    expect(INTENT_REASON_VALUES).toHaveLength(9);
    expect(INTENT_REASON_VALUES).toContain("hiring_freeze_signals");
    expect(INTENT_REASON_VALUES).toContain("role_disappeared");
  });
});
