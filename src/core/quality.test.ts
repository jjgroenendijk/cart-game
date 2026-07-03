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
