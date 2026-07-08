import { describe, expect, it } from "vitest";
import {
  bloomForCycleT,
  exposureForCycleT,
  godrayPhaseStrength,
  godrayScreenFade,
} from "./postFxPhase";

describe("bloomForCycleT", () => {
  it("dawn (cycleT=0, tierScale=1) -> threshold 1.5, strength 0.55, radius 0.35", () => {
    const b = bloomForCycleT(0, 1);
    expect(b.threshold).toBeCloseTo(1.5, 6);
    expect(b.strength).toBeCloseTo(0.55, 6);
    expect(b.radius).toBeCloseTo(0.35, 6);
  });

  it("day (cycleT=0.25, tierScale=1) -> threshold 2.1, strength 0.30, radius 0.35", () => {
    const b = bloomForCycleT(0.25, 1);
    expect(b.threshold).toBeCloseTo(2.1, 6);
    expect(b.strength).toBeCloseTo(0.3, 6);
    expect(b.radius).toBeCloseTo(0.35, 6);
  });

  it("dusk (cycleT=0.5, tierScale=1) -> threshold 1.5, strength 0.55", () => {
    const b = bloomForCycleT(0.5, 1);
    expect(b.threshold).toBeCloseTo(1.5, 6);
    expect(b.strength).toBeCloseTo(0.55, 6);
  });

  it("night (cycleT=0.75, tierScale=1) -> threshold 0.7, strength 0.45", () => {
    const b = bloomForCycleT(0.75, 1);
    expect(b.threshold).toBeCloseTo(0.7, 6);
    expect(b.strength).toBeCloseTo(0.45, 6);
  });

  it("tierScale=0 zeroes strength in every phase (pass off), threshold/radius untouched", () => {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const b = bloomForCycleT(t, 0);
      expect(b.strength).toBe(0);
      expect(b.radius).toBeCloseTo(0.35, 6);
    }
  });

  it("tierScale=0.85 scales strength = base * 0.85", () => {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const base = bloomForCycleT(t, 1).strength;
      const scaled = bloomForCycleT(t, 0.85).strength;
      expect(scaled).toBeCloseTo(base * 0.85, 6);
    }
  });

  it("midpoint cycleT=0.375 (day->dusk) blends threshold + strength, not an endpoint", () => {
    const b = bloomForCycleT(0.375, 1);
    expect(b.threshold).toBeGreaterThan(1.5);
    expect(b.threshold).toBeLessThan(2.1);
    expect(b.strength).toBeGreaterThan(0.3);
    expect(b.strength).toBeLessThan(0.55);
  });

  it("night threshold (0.7) is LOW — strictly below day threshold (2.1)", () => {
    const night = bloomForCycleT(0.75, 1).threshold;
    const day = bloomForCycleT(0.25, 1).threshold;
    expect(night).toBeLessThan(day);
  });

  it("radius is phase-agnostic (constant 0.35 across the cycle)", () => {
    for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9]) {
      expect(bloomForCycleT(t, 1).radius).toBeCloseTo(0.35, 6);
    }
  });
});

describe("exposureForCycleT", () => {
  it("day (cycleT=0.25) -> 1.06 (brightest)", () => {
    expect(exposureForCycleT(0.25)).toBeCloseTo(1.06, 6);
  });

  it("night (cycleT=0.75) -> 0.92 (darkest)", () => {
    expect(exposureForCycleT(0.75)).toBeCloseTo(0.92, 6);
  });

  it("dawn (cycleT=0) -> 0.97", () => {
    expect(exposureForCycleT(0)).toBeCloseTo(0.97, 6);
  });

  it("dusk (cycleT=0.5) -> 0.97 (same as dawn)", () => {
    expect(exposureForCycleT(0.5)).toBeCloseTo(0.97, 6);
  });

  it("midpoint cycleT=0.375 (day->dusk) blends, not an endpoint", () => {
    const e = exposureForCycleT(0.375);
    expect(e).toBeGreaterThan(0.97);
    expect(e).toBeLessThan(1.06);
  });
});

describe("godrayPhaseStrength", () => {
  it("elevDeg=10 (inside 4-18 window) -> ~1 (full)", () => {
    expect(godrayPhaseStrength(10)).toBeCloseTo(1, 6);
  });

  it("elevDeg=0 (horizon) -> strictly between 0 and 1", () => {
    const v = godrayPhaseStrength(0);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("elevDeg=60 (high noon) -> 0", () => {
    expect(godrayPhaseStrength(60)).toBe(0);
  });

  it("elevDeg=-10 (night) -> 0", () => {
    expect(godrayPhaseStrength(-10)).toBe(0);
  });

  it("never exceeds [0, 1]", () => {
    for (const d of [-90, -3, 4, 11, 18, 45, 90]) {
      const v = godrayPhaseStrength(d);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("godrayScreenFade", () => {
  it("visible=false -> 0", () => {
    expect(godrayScreenFade(0.5, 0.5, false)).toBe(0);
  });

  it("centered uv (0.5, 0.5), visible=true -> ~1 (full)", () => {
    expect(godrayScreenFade(0.5, 0.5, true)).toBeCloseTo(1, 6);
  });

  it("near-edge uv (0.95, 0.5), visible=true -> close to 0", () => {
    const f = godrayScreenFade(0.95, 0.5, true);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(0.4);
  });

  it("off-frame uv (1.5, 0.5), visible=true -> 0 (past the ramp)", () => {
    expect(godrayScreenFade(1.5, 0.5, true)).toBe(0);
  });
});
