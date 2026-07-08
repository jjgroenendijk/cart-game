import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIGNETTE_RADIUS,
  DEFAULT_VIGNETTE_STRENGTH,
  applyPostGradeToPass,
  computePostGrade,
  gradeForCycleT,
  vignetteFactor,
} from "./postGrade";

describe("vignetteFactor", () => {
  it("center (0.5, 0.5) is exactly 1.0 (d=0) for any positive strength/radius", () => {
    expect(vignetteFactor(0.5, 0.5, 0.12, 0.35)).toBe(1);
    expect(vignetteFactor(0.5, 0.5, 0.99, 0.01)).toBe(1);
  });

  it("corner (0,0) and (1,1) with strength=0.12 radius=0.35 -> 0.88", () => {
    expect(vignetteFactor(0, 0, 0.12, 0.35)).toBeCloseTo(1 - 0.12, 6);
    expect(vignetteFactor(1, 1, 0.12, 0.35)).toBeCloseTo(1 - 0.12, 6);
  });

  it("strength=0 -> factor 1.0 at a corner too (identity/no-op)", () => {
    expect(vignetteFactor(0, 0, 0, 0.35)).toBe(1);
  });

  it("inside radius (point closer than radius) -> factor 1.0 (smoothstep=0 below radius)", () => {
    expect(
      vignetteFactor(0.5, 0.5 - DEFAULT_VIGNETTE_RADIUS / 2, 0.12, DEFAULT_VIGNETTE_RADIUS),
    ).toBe(1);
  });

  it("mid distance (0.5, 0.0) radius 0.35 (d=0.5) -> factor strictly between 0.88 and 1", () => {
    const f = vignetteFactor(0.5, 0.0, 0.12, 0.35);
    expect(f).toBeGreaterThan(1 - 0.12);
    expect(f).toBeLessThan(1);
  });

  it("monotonic: factor decreases from center to corner", () => {
    const center = vignetteFactor(0.5, 0.5, 0.12, 0.35);
    const mid = vignetteFactor(0.5, 0.0, 0.12, 0.35);
    const corner = vignetteFactor(0, 0, 0.12, 0.35);
    expect(center).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(corner);
  });
});

describe("gradeForCycleT", () => {
  it("day (cycleT=0.25) yields identity (sat/warm/lift ~= 0)", () => {
    const g = gradeForCycleT(0.25);
    expect(g.saturation).toBeCloseTo(0, 6);
    expect(g.warmth).toBeCloseTo(0, 6);
    expect(g.lift).toBeCloseTo(0, 6);
  });

  it("dawn (cycleT=0) -> {0.06, 0.04, 0}", () => {
    const g = gradeForCycleT(0);
    expect(g.saturation).toBeCloseTo(0.06, 6);
    expect(g.warmth).toBeCloseTo(0.04, 6);
    expect(g.lift).toBeCloseTo(0, 6);
  });

  it("dusk (cycleT=0.5) -> same as dawn {0.06, 0.04, 0}", () => {
    const g = gradeForCycleT(0.5);
    expect(g.saturation).toBeCloseTo(0.06, 6);
    expect(g.warmth).toBeCloseTo(0.04, 6);
    expect(g.lift).toBeCloseTo(0, 6);
  });

  it("night (cycleT=0.75) -> {-0.15, -0.05, 0.01}", () => {
    const g = gradeForCycleT(0.75);
    expect(g.saturation).toBeCloseTo(-0.15, 6);
    expect(g.warmth).toBeCloseTo(-0.05, 6);
    expect(g.lift).toBeCloseTo(0.01, 6);
  });

  it("midpoint cycleT=0.375 (day->dusk) blends, not an endpoint", () => {
    const g = gradeForCycleT(0.375);
    expect(g.saturation).toBeGreaterThan(0);
    expect(g.saturation).toBeLessThan(0.06);
    expect(g.warmth).toBeGreaterThan(0);
    expect(g.warmth).toBeLessThan(0.04);
  });

  it("wrap night->dawn cycleT=0.875 blends, not equal to either endpoint", () => {
    const g = gradeForCycleT(0.875);
    expect(g.saturation).toBeGreaterThan(-0.15);
    expect(g.saturation).toBeLessThan(0.06);
  });

  it("continuity: smooth at keyframe day (0.25 +- 1e-4 ~= 0.25)", () => {
    const at = gradeForCycleT(0.25);
    const below = gradeForCycleT(0.25 - 1e-4);
    const above = gradeForCycleT(0.25 + 1e-4);
    expect(below.saturation).toBeCloseTo(at.saturation, 4);
    expect(below.warmth).toBeCloseTo(at.warmth, 4);
    expect(below.lift).toBeCloseTo(at.lift, 4);
    expect(above.saturation).toBeCloseTo(at.saturation, 4);
    expect(above.warmth).toBeCloseTo(at.warmth, 4);
    expect(above.lift).toBeCloseTo(at.lift, 4);
  });
});

describe("default vignette constants", () => {
  it("DEFAULT_VIGNETTE_STRENGTH = 0.12, DEFAULT_VIGNETTE_RADIUS = 0.35", () => {
    expect(DEFAULT_VIGNETTE_STRENGTH).toBeCloseTo(0.12, 6);
    expect(DEFAULT_VIGNETTE_RADIUS).toBeCloseTo(0.35, 6);
  });
});

describe("computePostGrade + applyPostGradeToPass", () => {
  it("day (cycleT=0.25, strength 1) -> grade neutral + default vignette", () => {
    const u = computePostGrade(0.25, 1);
    expect(u.gradeSaturation).toBeCloseTo(0, 6);
    expect(u.gradeWarmth).toBeCloseTo(0, 6);
    expect(u.gradeLift).toBeCloseTo(0, 6);
    expect(u.vignetteStrength).toBeCloseTo(DEFAULT_VIGNETTE_STRENGTH, 6);
    expect(u.vignetteRadius).toBeCloseTo(DEFAULT_VIGNETTE_RADIUS, 6);
  });

  it("dusk (cycleT=0.5, strength 1) -> warm + saturated, full vignette", () => {
    const u = computePostGrade(0.5, 1);
    expect(u.gradeWarmth).toBeCloseTo(0.04, 6);
    expect(u.gradeSaturation).toBeCloseTo(0.06, 6);
    expect(u.vignetteStrength).toBeCloseTo(DEFAULT_VIGNETTE_STRENGTH, 6);
  });

  it("night (cycleT=0.75, strength 1) -> desaturated + lifted blacks", () => {
    const u = computePostGrade(0.75, 1);
    expect(u.gradeSaturation).toBeCloseTo(-0.15, 6);
    expect(u.gradeLift).toBeCloseTo(0.01, 6);
  });

  it("strength 0 -> pre-064 identity (all neutral; radius stays)", () => {
    const u = computePostGrade(0.5, 0);
    expect(u.vignetteStrength).toBeCloseTo(0, 6);
    expect(u.gradeSaturation).toBeCloseTo(0, 6);
    expect(u.gradeWarmth).toBeCloseTo(0, 6);
    expect(u.gradeLift).toBeCloseTo(0, 6);
    expect(u.vignetteRadius).toBeCloseTo(DEFAULT_VIGNETTE_RADIUS, 6);
  });

  it("strength scales the grade deltas and vignette darkening", () => {
    const u = computePostGrade(0.5, 0.5);
    expect(u.gradeWarmth).toBeCloseTo(0.04 * 0.5, 6);
    expect(u.vignetteStrength).toBeCloseTo(DEFAULT_VIGNETTE_STRENGTH * 0.5, 6);
  });

  it("applyPostGradeToPass writes all 5 uniforms into a sink", () => {
    const sink = {
      vignetteStrength: 0,
      vignetteRadius: 0,
      gradeSaturation: 0,
      gradeWarmth: 0,
      gradeLift: 0,
    };
    const u = computePostGrade(0.5, 1);
    applyPostGradeToPass(sink, u);
    expect(sink.vignetteStrength).toBeCloseTo(u.vignetteStrength, 6);
    expect(sink.vignetteRadius).toBeCloseTo(u.vignetteRadius, 6);
    expect(sink.gradeSaturation).toBeCloseTo(u.gradeSaturation, 6);
    expect(sink.gradeWarmth).toBeCloseTo(u.gradeWarmth, 6);
    expect(sink.gradeLift).toBeCloseTo(u.gradeLift, 6);
  });
});
