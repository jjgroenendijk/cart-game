import { describe, expect, it } from "vitest";
import { DEFAULT_QUALITY, qualityKnobs, type QualityTier } from "./quality";

describe("DEFAULT_QUALITY", () => {
  it("is high (preserves the pre-011 Renderer look)", () => {
    expect(DEFAULT_QUALITY).toBe("high");
  });
});

describe("qualityKnobs (pure)", () => {
  it("low tier is fixed and ignores dpr", () => {
    const expected = {
      pixelRatio: 1,
      shadowMapSize: 1024,
      shadowCameraFar: 120,
      shadowHalfExtent: 60,
      vfxParticleBudget: 512,
      skidSegments: 256,
      waterGlintIntensity: 0,
      postGradeStrength: 1,
      sunHaloStrength: 0.25,
      godRayStrength: 0.2,
      lensFlareStrength: 0.3,
    };
    expect(qualityKnobs("low", 1)).toEqual(expected);
    expect(qualityKnobs("low", 3)).toEqual(expected);
  });

  it("med tier is fixed and ignores dpr", () => {
    const expected = {
      pixelRatio: 1.5,
      shadowMapSize: 2048,
      shadowCameraFar: 200,
      shadowHalfExtent: 80,
      vfxParticleBudget: 1536,
      skidSegments: 512,
      waterGlintIntensity: 1,
      postGradeStrength: 1,
      sunHaloStrength: 0.35,
      godRayStrength: 0.35,
      lensFlareStrength: 0.4,
    };
    expect(qualityKnobs("med", 1)).toEqual(expected);
    expect(qualityKnobs("med", 3)).toEqual(expected);
  });

  it("high tier clamps dpr to 2 (dpr=3 -> 2)", () => {
    const k = qualityKnobs("high", 3);
    expect(k.pixelRatio).toBe(2);
    expect(k.shadowMapSize).toBe(2048);
    expect(k.shadowCameraFar).toBe(400);
    expect(k.shadowHalfExtent).toBe(80);
  });

  it("high tier passes dpr<2 through unchanged (dpr=1 -> 1)", () => {
    expect(qualityKnobs("high", 1).pixelRatio).toBe(1);
  });

  it("high tier passes fractional dpr through (dpr=1.5 -> 1.5)", () => {
    expect(qualityKnobs("high", 1.5).pixelRatio).toBe(1.5);
  });

  it("high tier exposes the expected shadow extents", () => {
    const k = qualityKnobs("high", 2);
    expect(k.shadowMapSize).toBe(2048);
    expect(k.shadowCameraFar).toBe(400);
    expect(k.shadowHalfExtent).toBe(80);
  });

  it("throws on an unknown tier", () => {
    expect(() => qualityKnobs("ultra" as QualityTier, 2)).toThrow(/unknown tier/);
  });
});

describe("qualityKnobs — no-regression vs pre-011 Renderer defaults", () => {
  // The pre-011 Renderer hardcoded: pixelRatio min(dpr,2), mapSize 2048,
  // camera.far 400, ortho half-extent 80 (left/right/top/bottom +-80).
  // qualityKnobs("high", dpr) MUST reproduce those exactly so the default
  // tier preserves the current look.
  it("reproduces the pre-011 hardcoded values at dpr=2", () => {
    expect(qualityKnobs("high", 2)).toEqual({
      pixelRatio: 2,
      shadowMapSize: 2048,
      shadowCameraFar: 400,
      shadowHalfExtent: 80,
      vfxParticleBudget: 3072,
      skidSegments: 1024,
      waterGlintIntensity: 1,
      postGradeStrength: 1,
      sunHaloStrength: 0.45,
      godRayStrength: 0.5,
      lensFlareStrength: 0.5,
    });
  });
});

describe("vfx budgets", () => {
  it("low: 512 particles, 256 skid segments", () => {
    const k = qualityKnobs("low", 1);
    expect(k.vfxParticleBudget).toBe(512);
    expect(k.skidSegments).toBe(256);
  });

  it("med: 1536 particles, 512 skid segments", () => {
    const k = qualityKnobs("med", 1);
    expect(k.vfxParticleBudget).toBe(1536);
    expect(k.skidSegments).toBe(512);
  });

  it("high: 3072 particles, 1024 skid segments", () => {
    const k = qualityKnobs("high", 1);
    expect(k.vfxParticleBudget).toBe(3072);
    expect(k.skidSegments).toBe(1024);
  });
});

describe("water glint knob", () => {
  it("low zeroes glint (saves the per-fragment sun math)", () => {
    expect(qualityKnobs("low", 1).waterGlintIntensity).toBe(0);
  });

  it("med keeps glint on", () => {
    expect(qualityKnobs("med", 1).waterGlintIntensity).toBe(1);
  });

  it("high keeps glint on", () => {
    expect(qualityKnobs("high", 1).waterGlintIntensity).toBe(1);
  });
});

describe("post-grade strength", () => {
  it("low keeps the grade full (near-free ALU)", () => {
    expect(qualityKnobs("low", 1).postGradeStrength).toBe(1);
  });

  it("med keeps the grade full", () => {
    expect(qualityKnobs("med", 1).postGradeStrength).toBe(1);
  });

  it("high keeps the grade full", () => {
    expect(qualityKnobs("high", 1).postGradeStrength).toBe(1);
  });
});

describe("sun-effect strengths (159)", () => {
  it("is non-zero on every tier so a toggle always does something", () => {
    for (const tier of ["low", "med", "high"] as const) {
      const k = qualityKnobs(tier, 1);
      expect(k.sunHaloStrength).toBeGreaterThan(0);
      expect(k.godRayStrength).toBeGreaterThan(0);
      expect(k.lensFlareStrength).toBeGreaterThan(0);
    }
  });

  it("scales up from low to high (subtler on low, not off)", () => {
    const lo = qualityKnobs("low", 1);
    const hi = qualityKnobs("high", 1);
    expect(hi.sunHaloStrength).toBeGreaterThan(lo.sunHaloStrength);
    expect(hi.godRayStrength).toBeGreaterThan(lo.godRayStrength);
    expect(hi.lensFlareStrength).toBeGreaterThan(lo.lensFlareStrength);
  });

  it("stays restrained (<= 0.5) so effects read as soft painted, not neon", () => {
    const hi = qualityKnobs("high", 1);
    expect(hi.sunHaloStrength).toBeLessThanOrEqual(0.5);
    expect(hi.godRayStrength).toBeLessThanOrEqual(0.5);
    expect(hi.lensFlareStrength).toBeLessThanOrEqual(0.5);
  });
});
