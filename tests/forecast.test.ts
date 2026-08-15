/**
 * Interview Forecast — the plain-language reduction candidates actually read.
 *
 * The property that matters most here is FAITHFULNESS: the percentage shown to
 * a candidate must be the exact rate the Evidence Engine computed, not a
 * re-derivation that could drift from it. A forecast that disagrees with the
 * fingerprint it summarizes is worse than no forecast.
 */

import { describe, expect, it } from "vitest";
import { buildForecast, hasAnyForecast, FORECAST_MIN_REPORTS_FOR_MODE } from "@/lib/fingerprint/forecast";
import { buildBehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { describeBase } from "@/lib/evidence";
import type { EvidenceItem, EvidenceSet } from "@/lib/evidence";

function evidenceItem(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "family" | "weight">): EvidenceItem {
  return {
    sourceKey: fields.family === "first_party" ? "candidatevoice" : "reddit",
    organizationId: "org-1",
    reportedMonth: null,
    stage: null,
    outcome: null,
    experienceBucket: null,
    responseTimeBucket: null,
    lastInteractionGap: null,
    reason: null,
    paymentFlag: null,
    callDuration: null,
    firstInteractionOutcome: null,
    applicationChannel: null,
    salaryHistoryStage: null,
    salaryProofType: null,
    salaryProofStage: null,
    salaryRangeDisclosed: null,
    reporterType: "candidate",
    exitExperienceLetter: null,
    exitSettlement: null,
    exitDocumentation: null,
    wouldRecommend: null,
    tenureBucket: null,
    conductEnvironment: null,
    verificationTier: "unverified",
    extractionConfidence: null,
    ...fields,
  };
}

function evidenceSet(items: EvidenceItem[], globalMultiplier = 0.35): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier };
}

function line(lines: ReturnType<typeof buildForecast>, key: string) {
  const l = lines.find((x) => x.key === key);
  if (!l) throw new Error(`missing forecast line ${key}`);
  return l;
}

/** 10 reports: 4 ghosted, 3 offers, 6 given a reason, most heard back in 4-7d, most reached technical. */
function standardFixture(): EvidenceItem[] {
  return Array.from({ length: 10 }, (_, i) =>
    evidenceItem({
      id: `fp-${i}`,
      family: "first_party",
      weight: 1,
      outcome: i < 4 ? "no_response" : i < 7 ? "offer" : "rejected",
      lastInteractionGap: i < 4 ? "30+" : "0-7",
      responseTimeBucket: i < 6 ? "4-7" : "0-3",
      stage: i < 7 ? "technical" : "final",
      reason: i < 6 ? "skill_mismatch" : "no_reason",
      paymentFlag: false,
    })
  );
}

describe("forecast faithfulness to the engine", () => {
  it("shows the ghost RATE the engine computed, not the inverted score", () => {
    const fingerprint = buildBehaviouralFingerprint(evidenceSet(standardFixture()));
    const lines = buildForecast(fingerprint, standardFixture());
    const ghosting = fingerprint.dimensions.find((d) => d.key === "ghosting")!;

    // The dimension SCORE is 100*(1-rate) = 60. The forecast must show 40%, the rate.
    expect(ghosting.score).toBeCloseTo(60, 5);
    expect(line(lines, "ghosting").value).toBe("40%");
  });

  it("every rate line matches its dimension's metric.value exactly", () => {
    const items = standardFixture();
    const fingerprint = buildBehaviouralFingerprint(evidenceSet(items));
    const lines = buildForecast(fingerprint, items);

    for (const key of ["ghosting", "offer_probability", "transparency"] as const) {
      const dim = fingerprint.dimensions.find((d) => d.key === key)!;
      const forecastLine = line(lines, key);
      if (dim.suppressed || dim.metric.value === null) continue;
      expect(forecastLine.value).toBe(`${Math.round(dim.metric.value * 100)}%`);
    }
  });

  it("reports the offer rate and reason-given rate as percentages", () => {
    const items = standardFixture();
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(items)), items);
    expect(line(lines, "offer_probability").value).toBe("30%"); // 3 of 10
    expect(line(lines, "transparency").value).toBe("60%");      // 6 of 10 not no_reason
  });

  it("carries the raw counts as the basis, so the reader sees the sample", () => {
    const items = standardFixture();
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(items)), items);
    expect(line(lines, "ghosting").basis).toBe("4 of 10 reports");
  });
});

describe("forecast tone", () => {
  it("marks a high ghost rate bad and a low one good", () => {
    const heavy = Array.from({ length: 10 }, (_, i) =>
      evidenceItem({ id: `g-${i}`, family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "30+" })
    );
    const heavyLines = buildForecast(buildBehaviouralFingerprint(evidenceSet(heavy)), heavy);
    expect(line(heavyLines, "ghosting").tone).toBe("bad");

    const clean = Array.from({ length: 10 }, (_, i) =>
      evidenceItem({ id: `c-${i}`, family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" })
    );
    const cleanLines = buildForecast(buildBehaviouralFingerprint(evidenceSet(clean)), clean);
    expect(line(cleanLines, "ghosting").tone).toBe("good");
  });

  it("inverts the ramp for offer rate — high is good there, unlike ghosting", () => {
    const clean = Array.from({ length: 10 }, (_, i) =>
      evidenceItem({ id: `c-${i}`, family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" })
    );
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(clean)), clean);
    // 100% offers is good; the same 100% on ghosting would be bad.
    expect(line(lines, "offer_probability").tone).toBe("good");
  });
});

describe("forecast suppression — never guess", () => {
  it("returns a reason instead of a number when a dimension is suppressed", () => {
    const thin = [evidenceItem({ id: "a", family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" })];
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(thin)), thin);
    const ghosting = line(lines, "ghosting");
    expect(ghosting.value).toBeNull();
    expect(ghosting.unavailableReason).toBeTruthy();
  });

  it("suppresses the distribution lines below the mode floor", () => {
    const two = Array.from({ length: FORECAST_MIN_REPORTS_FOR_MODE - 1 }, (_, i) =>
      evidenceItem({ id: `m-${i}`, family: "first_party", weight: 1, responseTimeBucket: "0-3", stage: "technical" })
    );
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(two)), two);
    expect(line(lines, "response_time").value).toBeNull();
    expect(line(lines, "furthest_stage").value).toBeNull();
  });

  it("surfaces Payment Risk's corroboration gate as its own reason, not a generic one", () => {
    // One source, effectiveN 2 → uncorroborated, not merely 'insufficient'.
    const single = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: true }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, paymentFlag: false }),
    ];
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(single)), single);
    const payment = line(lines, "payment_risk");
    expect(payment.value).toBeNull();
    expect(payment.unavailableReason).toMatch(/corroboration/i);
  });

  it("hasAnyForecast is false when nothing at all is computable", () => {
    expect(hasAnyForecast(buildForecast(buildBehaviouralFingerprint(evidenceSet([])), []))).toBe(false);
  });
});

describe("forecast distribution lines", () => {
  it("reports the modal response bucket in plain language", () => {
    const items = standardFixture();
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(items)), items);
    expect(line(lines, "response_time").value).toBe("in 4–7 days"); // 6 of 10
  });

  it("reports the modal stage with a human label", () => {
    const items = standardFixture();
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(items)), items);
    expect(line(lines, "furthest_stage").value).toBe("Technical"); // 7 of 10
  });

  it("picks the mode by WEIGHT, so low-trust external reports cannot outvote first-party", () => {
    // 3 first-party at full weight say 0-3; 9 external at 0.05 say 15+.
    // By raw count 15+ wins 9-3; by weight 0-3 wins 3.0 to 0.45.
    const items: EvidenceItem[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        evidenceItem({ id: `fp-${i}`, family: "first_party", weight: 1, responseTimeBucket: "0-3" })
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        evidenceItem({ id: `ext-${i}`, family: "external", weight: 0.05, responseTimeBucket: "15+" })
      ),
    ];
    const lines = buildForecast(buildBehaviouralFingerprint(evidenceSet(items)), items);
    expect(line(lines, "response_time").value).toBe("within 3 days");
  });
});

describe("sunset regression — forecast at globalMultiplier = 0", () => {
  it("matches the first-party-only forecast exactly when external evidence is silenced", () => {
    const firstParty = standardFixture();
    const silenced: EvidenceItem[] = Array.from({ length: 20 }, (_, i) =>
      evidenceItem({
        id: `ext-${i}`,
        family: "external",
        weight: 0,
        outcome: "no_response",
        lastInteractionGap: "30+",
        responseTimeBucket: "15+",
        stage: "applied",
        reason: "no_reason",
        paymentFlag: true,
        sourceKey: "reddit",
      })
    );

    const only = buildForecast(buildBehaviouralFingerprint(evidenceSet(firstParty, 0)), firstParty);
    const mixed = buildForecast(
      buildBehaviouralFingerprint(evidenceSet([...firstParty, ...silenced], 0)),
      [...firstParty, ...silenced]
    );

    for (const key of ["ghosting", "offer_probability", "transparency", "response_time", "furthest_stage"]) {
      expect({ key, v: line(mixed, key).value }).toEqual({ key, v: line(only, key).value });
    }
  });
});
