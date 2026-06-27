import { describe, expect, it } from "vitest";
import { DEFAULT_SELECTION, validateSelection } from "./kartSelection";

describe("kartSelection (024)", () => {
  it("validateSelection returns DEFAULT_SELECTION for undefined", () => {
    expect(validateSelection(undefined)).toEqual(DEFAULT_SELECTION);
  });

  it("validateSelection returns DEFAULT_SELECTION for a non-array", () => {
    expect(validateSelection("speed")).toEqual(DEFAULT_SELECTION);
    expect(validateSelection({ 0: "speed", length: 1 })).toEqual(DEFAULT_SELECTION);
    expect(validateSelection(42)).toEqual(DEFAULT_SELECTION);
    expect(validateSelection(null)).toEqual(DEFAULT_SELECTION);
  });

  it("validateSelection returns DEFAULT_SELECTION for an empty array", () => {
    expect(validateSelection([])).toEqual(DEFAULT_SELECTION);
  });

  it("validateSelection fills a missing slot with balanced", () => {
    expect(validateSelection(["speed"])).toEqual(["speed", "balanced"]);
  });

  it("validateSelection round-trips valid ids", () => {
    expect(validateSelection(["speed", "heavy"])).toEqual(["speed", "heavy"]);
  });

  it("validateSelection defaults an invalid slot to balanced", () => {
    expect(validateSelection(["speed", "bogus"])).toEqual(["speed", "balanced"]);
  });

  it("validateSelection defaults every slot when all ids are invalid", () => {
    expect(validateSelection(["bogus", "nope"])).toEqual(DEFAULT_SELECTION);
  });

  it("validateSelection ignores elements beyond the first two slots", () => {
    expect(validateSelection(["balanced", "balanced", "speed"])).toEqual(["balanced", "balanced"]);
  });

  it("validateSelection returns a fresh array, not DEFAULT_SELECTION itself", () => {
    const a = validateSelection(undefined);
    const b = validateSelection(undefined);
    expect(a).not.toBe(DEFAULT_SELECTION);
    expect(a).not.toBe(b);
    a.push("speed");
    expect(validateSelection(undefined)).toEqual(DEFAULT_SELECTION);
  });
});
