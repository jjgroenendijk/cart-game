import { describe, expect, it } from "vitest";
import { DEFAULT_QUALITY, qualityKnobs, resolveStreamPlan, type QualityTier } from "./quality";

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
      farShadowMapSize: 0,
      farShadowHalfExtent: 0,
      farShadowCameraFar: 0,
      cascadeSplit: 0,
      cascadeBlendWidth: 0,
      vfxParticleBudget: 512,
      skidSegments: 256,
      waterGlintIntensity: 0,
      postGradeStrength: 1,
      sunHaloStrength: 0.25,
      godRayStrength: 0.2,
      lensFlareStrength: 0.3,
      groundMistStrength: 0,
      aoStrength: 0,
      aoSlices: 0,
      smaa: true,
      terrainDrawCap: 200,
      terrainSeedBudget: 8,
      terrainCrossFadeSeconds: 0,
      dressingDensityMin: 0.25,
      terrainBackdropReach: 0,
      skyEnvSize: 0,
    };
    expect(qualityKnobs("low", 1)).toEqual(expected);
    expect(qualityKnobs("low", 3)).toEqual(expected);
  });

  it("med tier is fixed and ignores dpr", () => {
    const expected = {
      pixelRatio: 1.5,
      shadowMapSize: 2048,
      shadowCameraFar: 200,
      shadowHalfExtent: 40,
      farShadowMapSize: 1024,
      farShadowHalfExtent: 200,
      farShadowCameraFar: 400,
      cascadeSplit: 40,
      cascadeBlendWidth: 8,
      vfxParticleBudget: 1536,
      skidSegments: 512,
      waterGlintIntensity: 1,
      postGradeStrength: 1,
      sunHaloStrength: 0.35,
      godRayStrength: 0.35,
      lensFlareStrength: 0.4,
      groundMistStrength: 0.5,
      aoStrength: 0.5,
      aoSlices: 3,
      smaa: true,
      terrainDrawCap: 280,
      terrainSeedBudget: 12,
      terrainCrossFadeSeconds: 0.4,
      dressingDensityMin: 0.3,
      terrainBackdropReach: 0,
      skyEnvSize: 64,
    };
    expect(qualityKnobs("med", 1)).toEqual(expected);
    expect(qualityKnobs("med", 3)).toEqual(expected);
  });

  it("high tier clamps dpr to 2 (dpr=3 -> 2)", () => {
    const k = qualityKnobs("high", 3);
    expect(k.pixelRatio).toBe(2);
    expect(k.shadowMapSize).toBe(2048);
    expect(k.shadowCameraFar).toBe(400);
    expect(k.shadowHalfExtent).toBe(40);
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
    expect(k.shadowHalfExtent).toBe(40);
  });

  it("throws on an unknown tier", () => {
    expect(() => qualityKnobs("ultra" as QualityTier, 2)).toThrow(/unknown tier/);
  });
});

describe("qualityKnobs — no-regression anchor", () => {
  // The pre-011 Renderer hardcoded: pixelRatio min(dpr,2), mapSize 2048,
  // camera.far 400, ortho half-extent 80 (left/right/top/bottom +-80). #144
  // tightened the high/med NEAR cascade to 40 (a far 200 m cascade now covers the
  // middle distance). LOW is the byte-identical anchor: far cascade OFF, near
  // half-extent 60, identical to pre-144.
  it("reproduces the high tier values at dpr=2", () => {
    expect(qualityKnobs("high", 2)).toEqual({
      pixelRatio: 2,
      shadowMapSize: 2048,
      shadowCameraFar: 400,
      shadowHalfExtent: 40,
      farShadowMapSize: 2048,
      farShadowHalfExtent: 200,
      farShadowCameraFar: 400,
      cascadeSplit: 40,
      cascadeBlendWidth: 8,
      vfxParticleBudget: 3072,
      skidSegments: 1024,
      waterGlintIntensity: 1,
      postGradeStrength: 1,
      sunHaloStrength: 0.45,
      godRayStrength: 0.5,
      lensFlareStrength: 0.5,
      groundMistStrength: 1,
      aoStrength: 1,
      aoSlices: 6,
      smaa: true,
      terrainDrawCap: 360,
      terrainSeedBudget: 16,
      terrainCrossFadeSeconds: 0.4,
      dressingDensityMin: 0.35,
      terrainBackdropReach: 0,
      skyEnvSize: 128,
    });
  });
});

describe("cascade shadow knobs (144)", () => {
  it("low: far cascade OFF (single near box, byte-identical to pre-144)", () => {
    const k = qualityKnobs("low", 1);
    expect(k.farShadowMapSize).toBe(0);
    expect(k.farShadowHalfExtent).toBe(0);
    expect(k.farShadowCameraFar).toBe(0);
    expect(k.cascadeSplit).toBe(0);
    expect(k.cascadeBlendWidth).toBe(0);
  });

  it("med: far cascade on (200 m half-extent, 8 m blend band)", () => {
    const k = qualityKnobs("med", 1);
    expect(k.farShadowMapSize).toBe(1024);
    expect(k.farShadowHalfExtent).toBe(200);
    expect(k.farShadowCameraFar).toBe(400);
    expect(k.cascadeSplit).toBe(40);
    expect(k.cascadeBlendWidth).toBe(8);
  });

  it("high: far cascade on with the bigger map (200 m half-extent, 8 m blend band)", () => {
    const k = qualityKnobs("high", 1);
    expect(k.farShadowMapSize).toBe(2048);
    expect(k.farShadowHalfExtent).toBe(200);
    expect(k.farShadowCameraFar).toBe(400);
    expect(k.cascadeSplit).toBe(40);
    expect(k.cascadeBlendWidth).toBe(8);
  });

  it("far map size scales up monotonically low(0) < med(1024) < high(2048)", () => {
    const lo = qualityKnobs("low", 1).farShadowMapSize;
    const me = qualityKnobs("med", 1).farShadowMapSize;
    const hi = qualityKnobs("high", 1).farShadowMapSize;
    expect(lo).toBeLessThan(me);
    expect(me).toBeLessThan(hi);
  });

  it("far half-extent > near half-extent on med AND high (far box is the wider cascade)", () => {
    const me = qualityKnobs("med", 1);
    const hi = qualityKnobs("high", 1);
    expect(me.farShadowHalfExtent).toBeGreaterThan(me.shadowHalfExtent);
    expect(hi.farShadowHalfExtent).toBeGreaterThan(hi.shadowHalfExtent);
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

describe("sky env capture size (283)", () => {
  it("low disables capture (0 = off, flat ambient unchanged)", () => {
    expect(qualityKnobs("low", 1).skyEnvSize).toBe(0);
  });

  it("med captures at 64px per face", () => {
    expect(qualityKnobs("med", 1).skyEnvSize).toBe(64);
  });

  it("high captures at 128px per face", () => {
    expect(qualityKnobs("high", 1).skyEnvSize).toBe(128);
  });

  it("scales up monotonically low(0) < med(64) < high(128)", () => {
    const lo = qualityKnobs("low", 1).skyEnvSize;
    const me = qualityKnobs("med", 1).skyEnvSize;
    const hi = qualityKnobs("high", 1).skyEnvSize;
    expect(lo).toBeLessThan(me);
    expect(me).toBeLessThan(hi);
  });
});

describe("ground-mist strength (228)", () => {
  it("low zeroes mist (off/identity)", () => {
    expect(qualityKnobs("low", 1).groundMistStrength).toBe(0);
  });

  it("med halves mist", () => {
    expect(qualityKnobs("med", 1).groundMistStrength).toBe(0.5);
  });

  it("high runs mist full", () => {
    expect(qualityKnobs("high", 1).groundMistStrength).toBe(1);
  });

  it("scales up monotonically low -> med -> high", () => {
    const lo = qualityKnobs("low", 1);
    const me = qualityKnobs("med", 1);
    const hi = qualityKnobs("high", 1);
    expect(lo.groundMistStrength).toBeLessThan(me.groundMistStrength);
    expect(me.groundMistStrength).toBeLessThan(hi.groundMistStrength);
  });
});

describe("ambient-occlusion strength + slices (235)", () => {
  it("low zeroes AO (off/identity)", () => {
    expect(qualityKnobs("low", 1).aoStrength).toBe(0);
  });

  it("med halves AO strength and uses 3 slices", () => {
    expect(qualityKnobs("med", 1).aoStrength).toBe(0.5);
    expect(qualityKnobs("med", 1).aoSlices).toBe(3);
  });

  it("high runs AO full with 6 slices", () => {
    expect(qualityKnobs("high", 1).aoStrength).toBe(1);
    expect(qualityKnobs("high", 1).aoSlices).toBe(6);
  });

  it("strength scales up monotonically low -> med -> high", () => {
    const lo = qualityKnobs("low", 1);
    const me = qualityKnobs("med", 1);
    const hi = qualityKnobs("high", 1);
    expect(lo.aoStrength).toBeLessThan(me.aoStrength);
    expect(me.aoStrength).toBeLessThan(hi.aoStrength);
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

describe("draw-distance / LOD budgets (205)", () => {
  // The pre-205 Game constants (applied to every tier): TERRAIN_DRAW_CAP 360,
  // TERRAIN_SEED_BUDGET 16, cross-fade 0.4, dressing densityMin 0.35. These are
  // the "current" budget the LOW tier must stay within, and HIGH (the default)
  // must reproduce exactly so nothing regresses.
  const CURRENT = {
    terrainDrawCap: 360,
    terrainSeedBudget: 16,
    terrainCrossFadeSeconds: 0.4,
    dressingDensityMin: 0.35,
  };

  it("high (the default tier) reproduces the pre-205 fixed constants exactly", () => {
    const k = qualityKnobs("high", 2);
    expect(k.terrainDrawCap).toBe(CURRENT.terrainDrawCap);
    expect(k.terrainSeedBudget).toBe(CURRENT.terrainSeedBudget);
    expect(k.terrainCrossFadeSeconds).toBe(CURRENT.terrainCrossFadeSeconds);
    expect(k.dressingDensityMin).toBe(CURRENT.dressingDensityMin);
  });

  it("pins the per-tier draw-distance + budget values", () => {
    expect(qualityKnobs("low", 1).terrainDrawCap).toBe(200);
    expect(qualityKnobs("med", 1).terrainDrawCap).toBe(280);
    expect(qualityKnobs("high", 1).terrainDrawCap).toBe(360);
    expect(qualityKnobs("low", 1).terrainSeedBudget).toBe(8);
    expect(qualityKnobs("med", 1).terrainSeedBudget).toBe(12);
    expect(qualityKnobs("high", 1).terrainSeedBudget).toBe(16);
    expect(qualityKnobs("low", 1).dressingDensityMin).toBe(0.25);
    expect(qualityKnobs("med", 1).dressingDensityMin).toBe(0.3);
    expect(qualityKnobs("high", 1).dressingDensityMin).toBe(0.35);
  });

  it("low tier stays within the current budget (<= the pre-205 constants)", () => {
    const lo = qualityKnobs("low", 1);
    expect(lo.terrainDrawCap).toBeLessThanOrEqual(CURRENT.terrainDrawCap);
    expect(lo.terrainSeedBudget).toBeLessThanOrEqual(CURRENT.terrainSeedBudget);
    expect(lo.terrainCrossFadeSeconds).toBeLessThanOrEqual(CURRENT.terrainCrossFadeSeconds);
    // Lower density floor = far decor thinned harder = cheaper, never fuller.
    expect(lo.dressingDensityMin).toBeLessThanOrEqual(CURRENT.dressingDensityMin);
  });

  it("draw reach + budgets scale up monotonically low -> med -> high", () => {
    const lo = qualityKnobs("low", 1);
    const me = qualityKnobs("med", 1);
    const hi = qualityKnobs("high", 1);
    expect(lo.terrainDrawCap).toBeLessThan(me.terrainDrawCap);
    expect(me.terrainDrawCap).toBeLessThan(hi.terrainDrawCap);
    expect(lo.terrainSeedBudget).toBeLessThan(me.terrainSeedBudget);
    expect(me.terrainSeedBudget).toBeLessThan(hi.terrainSeedBudget);
    expect(lo.dressingDensityMin).toBeLessThan(me.dressingDensityMin);
    expect(me.dressingDensityMin).toBeLessThan(hi.dressingDensityMin);
  });

  it("low disables the LOD cross-fade (no transient double terrain draw)", () => {
    expect(qualityKnobs("low", 1).terrainCrossFadeSeconds).toBe(0);
    expect(qualityKnobs("med", 1).terrainCrossFadeSeconds).toBeGreaterThan(0);
    expect(qualityKnobs("high", 1).terrainCrossFadeSeconds).toBeGreaterThan(0);
  });

  it("203 HLOD backdrop reach: shipped OFF (0) on every tier", () => {
    // The backdrop ring read as dark near-horizon "mountains" rather than
    // receding haze, so it ships disabled on all tiers; the TerrainBackdrop code
    // stays dormant until the look is retuned.
    for (const tier of ["low", "med", "high"] as const) {
      expect(qualityKnobs(tier, 1).terrainBackdropReach).toBe(0);
    }
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

describe("resolveStreamPlan (202/203/205)", () => {
  it("scales stream reach to the world but caps it at the tier drawCap", () => {
    const knobs = qualityKnobs("high", 1); // drawCap 360
    // Big world: half-extent past the cap clamps to the cap.
    const big = resolveStreamPlan(knobs, 1000);
    expect(big.streamRadius).toBe(360);
    expect(big.cullRadius).toBe(390);
  });

  it("keeps the compact near ring (140/170) on a small world", () => {
    const plan = resolveStreamPlan(qualityKnobs("high", 1), 100); // half-extent 50
    expect(plan.streamRadius).toBe(140);
    expect(plan.cullRadius).toBe(170);
  });

  it("emits the HLOD backdrop ring past the cull ring when reach > 0", () => {
    // Backdrop ships disabled on every tier (reach 0), so exercise the ring
    // logic with a synthetic knob set that opts it back in.
    const knobs = { ...qualityKnobs("high", 1), terrainBackdropReach: 220 };
    const plan = resolveStreamPlan(knobs, 1000); // cull 390 + reach 220
    expect(plan.backdrop).toEqual({ innerRadius: 390, outerRadius: 610 });
  });

  it("emits no backdrop when the tier reach is 0 (shipped default)", () => {
    const plan = resolveStreamPlan(qualityKnobs("high", 1), 1000);
    expect(plan.backdrop).toBeUndefined();
  });
});

describe("smaa (232)", () => {
  it("is enabled on every tier (scene has no AA through the composer otherwise)", () => {
    for (const tier of ["low", "med", "high"] as const) {
      expect(qualityKnobs(tier, 1).smaa).toBe(true);
    }
  });
});
