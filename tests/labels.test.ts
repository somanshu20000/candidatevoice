import { describe, it, expect } from "vitest";
import {
  reasonLabel,
  stageLabel,
  outcomeLabel,
  experienceLabel,
  reasonSummary,
} from "../src/utils/labels";

describe("enum labels", () => {
  it("renders every stored reason value as prose, never a raw token", () => {
    for (const value of ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other"]) {
      const label = reasonLabel(value);
      expect(label).not.toBe(value);
      expect(label).not.toMatch(/_/);
    }
  });

  it("maps each closed value set to its human label", () => {
    expect(reasonLabel("experience_mismatch")).toBe("Experience mismatch");
    expect(stageLabel("hr")).toBe("HR");
    expect(stageLabel("final")).toBe("Final round");
    expect(outcomeLabel("no_response")).toBe("No response");
    expect(experienceLabel("5-8")).toBe("5–8 years");
  });

  it("degrades an unknown value to something legible rather than blank or thrown", () => {
    // A value added to the database before this module is updated must still
    // render readably — silently blank text would hide real data from a reader.
    expect(reasonLabel("some_new_value")).toBe("Some new value");
    expect(stageLabel("take_home")).toBe("Take home");
  });

  it("returns an empty string for null/undefined/empty", () => {
    expect(reasonLabel(null)).toBe("");
    expect(reasonLabel(undefined)).toBe("");
    expect(stageLabel("")).toBe("");
  });

  describe("reasonSummary", () => {
    it("phrases the enum as a sentence instead of showing the token", () => {
      expect(reasonSummary("experience_mismatch")).toBe("Reason given: experience mismatch.");
      expect(reasonSummary("skill_mismatch")).toBe("Reason given: skill mismatch.");
    });

    it("handles the two values that do not read as a reason", () => {
      expect(reasonSummary("no_reason")).toBe("No reason was given.");
      expect(reasonSummary("other")).toBe("Reason given: other.");
    });

    it("has a defined output when no reason is stored", () => {
      expect(reasonSummary(null)).toBe("No reason recorded.");
      expect(reasonSummary("")).toBe("No reason recorded.");
    });

    it("never leaks an underscore into user-facing copy", () => {
      for (const value of ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other", "brand_new_enum"]) {
        expect(reasonSummary(value)).not.toMatch(/_/);
      }
    });
  });
});
