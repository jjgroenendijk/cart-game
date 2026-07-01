import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_OF_DAY,
  PHASE_TO_CYCLE_T,
  SPEED_PRESETS,
  phaseToStartSeconds,
  timeOfDayToEnvParams,
  validateTimeOfDayConfig,
} from "./timeOfDayConfig";

describe("timeOfDayConfig — phase map + presets (042)", () => {
  it("PHASE_TO_CYCLE_T has all 6 phases at the exact fractions", () => {
    expect(PHASE_TO_CYCLE_T).toEqual({
      dawn: 0,
      morning: 0.12,
      noon: 0.25,
      afternoon: 0.38,
      dusk: 0.5,
      night: 0.75,
    });
  });

  it("SPEED_PRESETS are slow 240, normal 120, fast 60", () => {
    expect(SPEED_PRESETS).toEqual({ slow: 240, normal: 120, fast: 60 });
  });

  it("DEFAULT_TIME_OF_DAY is dynamic / morning / 120", () => {
    expect(DEFAULT_TIME_OF_DAY).toEqual({
      mode: "dynamic",
      phase: "morning",
      dayLengthSeconds: 120,
    });
  });
});

describe("timeOfDayConfig — phaseToStartSeconds (042)", () => {
  it("noon at 120s = 30", () => {
    expect(phaseToStartSeconds("noon", 120)).toBe(30);
  });

  it("night at 120s = 90", () => {
    expect(phaseToStartSeconds("night", 120)).toBe(90);
  });

  it("morning at 240s = 28.8 (0.12 * 240; toBeCloseTo for float)", () => {
    expect(phaseToStartSeconds("morning", 240)).toBeCloseTo(28.8);
  });
});

describe("timeOfDayConfig — validateTimeOfDayConfig (042)", () => {
  it("passes a valid input through and returns a fresh object", () => {
    const input = { mode: "static", phase: "night", dayLengthSeconds: 60 };
    const out = validateTimeOfDayConfig(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("returns defaults for non-object / null / array", () => {
    expect(validateTimeOfDayConfig(undefined)).toEqual(DEFAULT_TIME_OF_DAY);
    expect(validateTimeOfDayConfig(null)).toEqual(DEFAULT_TIME_OF_DAY);
    expect(validateTimeOfDayConfig("dynamic")).toEqual(DEFAULT_TIME_OF_DAY);
    expect(validateTimeOfDayConfig(42)).toEqual(DEFAULT_TIME_OF_DAY);
    expect(validateTimeOfDayConfig([1, 2, 3])).toEqual(DEFAULT_TIME_OF_DAY);
  });

  it("clamps a bad mode to default but keeps a good phase/length", () => {
    const out = validateTimeOfDayConfig({
      mode: "fast",
      phase: "noon",
      dayLengthSeconds: 60,
    });
    expect(out).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 60 });
  });

  it("clamps an undefined mode to default", () => {
    const out = validateTimeOfDayConfig({ mode: undefined, phase: "dusk", dayLengthSeconds: 60 });
    expect(out).toEqual({ mode: "dynamic", phase: "dusk", dayLengthSeconds: 60 });
  });

  it("clamps a bad phase to default but keeps a good mode/length", () => {
    const out = validateTimeOfDayConfig({
      mode: "static",
      phase: "oops",
      dayLengthSeconds: 60,
    });
    expect(out).toEqual({ mode: "static", phase: "morning", dayLengthSeconds: 60 });
  });

  it("clamps a bad dayLengthSeconds to default", () => {
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: 0 }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: -5 }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: NaN }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: "120" }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: undefined }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
    expect(
      validateTimeOfDayConfig({ mode: "dynamic", phase: "noon", dayLengthSeconds: Infinity }),
    ).toEqual({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
  });

  it("returns a fresh object each call (not the DEFAULT reference)", () => {
    const a = validateTimeOfDayConfig({});
    const b = validateTimeOfDayConfig({});
    expect(a).toEqual(DEFAULT_TIME_OF_DAY);
    expect(a).not.toBe(DEFAULT_TIME_OF_DAY);
    expect(b).not.toBe(DEFAULT_TIME_OF_DAY);
    expect(a).not.toBe(b);
  });
});

describe("timeOfDayConfig — timeOfDayToEnvParams (042)", () => {
  it("dynamic + morning + 120 -> elapsed 14.4, frozen false", () => {
    const out = timeOfDayToEnvParams({
      mode: "dynamic",
      phase: "morning",
      dayLengthSeconds: 120,
    });
    expect(out.dayLengthSeconds).toBe(120);
    expect(out.frozen).toBe(false);
    expect(out.startElapsed).toBeCloseTo(14.4);
  });

  it("static + noon + 240 -> elapsed 60, frozen true", () => {
    expect(timeOfDayToEnvParams({ mode: "static", phase: "noon", dayLengthSeconds: 240 })).toEqual({
      dayLengthSeconds: 240,
      startElapsed: 60,
      frozen: true,
    });
  });
});
