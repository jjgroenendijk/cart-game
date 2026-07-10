import { describe, expect, it } from "vitest";
import { DEFAULT_SELECTION, validateSelection, type KartPick } from "./kartSelection";

const SPEED: KartPick = { variant: "speed", colorway: "glacier" };
const HEAVY: KartPick = { variant: "heavy", colorway: "violet" };

describe("kartSelection (024/083)", () => {
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

  it("validateSelection fills a missing slot with the default pick", () => {
    expect(validateSelection([SPEED])).toEqual([SPEED, DEFAULT_SELECTION[1]]);
  });

  it("validateSelection round-trips valid picks", () => {
    expect(validateSelection([SPEED, HEAVY])).toEqual([SPEED, HEAVY]);
  });

  it("validateSelection upgrades v1 variant-id strings to stock colorways", () => {
    expect(validateSelection(["speed", "heavy"])).toEqual([
      { variant: "speed", colorway: "glacier" },
      { variant: "heavy", colorway: "violet" },
    ]);
  });

  it("validateSelection keeps a chosen colorway on a valid variant", () => {
    expect(validateSelection([{ variant: "speed", colorway: "pearl" }])[0]).toEqual({
      variant: "speed",
      colorway: "pearl",
    });
  });

  it("validateSelection defaults an invalid variant to the default pick", () => {
    expect(validateSelection([SPEED, { variant: "bogus", colorway: "moss" }])).toEqual([
      SPEED,
      { variant: "balanced", colorway: "moss" },
    ]);
  });

  it("validateSelection falls back to the variant stock paint on a bad colorway", () => {
    expect(validateSelection([{ variant: "speed", colorway: "nope" }])[0]).toEqual(SPEED);
  });

  it("validateSelection defaults every slot when all entries are invalid", () => {
    expect(validateSelection(["bogus", "nope"])).toEqual(DEFAULT_SELECTION);
  });

  it("validateSelection ignores elements beyond the first two slots", () => {
    expect(validateSelection([SPEED, HEAVY, { variant: "grip", colorway: "moss" }])).toEqual([
      SPEED,
      HEAVY,
    ]);
  });

  it("validateSelection returns fresh picks, not DEFAULT_SELECTION itself", () => {
    const a = validateSelection(undefined);
    const b = validateSelection(undefined);
    expect(a).not.toBe(DEFAULT_SELECTION);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(DEFAULT_SELECTION[0]);
    a[0]!.variant = "speed";
    expect(validateSelection(undefined)).toEqual(DEFAULT_SELECTION);
  });
});
