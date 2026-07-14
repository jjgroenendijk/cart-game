/**
 * 011 quality-tier knob set. Pure mapping from a QualityTier + the device's
 * pixel ratio to the Renderer's pixelRatio + shadow extents (map size, camera
 * far, ortho half-extent). No Three.js or WebGL types: QualityKnobs carries
 * plain numbers so this module runs under jsdom unit tests. Renderer.setQuality
 * applies a tier's knobs to the live WebGLRenderer + sun shadow camera and
 * rebuilds the shadow map on change; the default tier "high" reproduces the
 * Renderer's pre-011 hardcoded look (012 wires user choice).
 *
 * Pure: no Three, no WebGL, no DOM, no side effects. Fully unit tested.
 */

export type QualityTier = "low" | "med" | "high";

export interface QualityKnobs {
  pixelRatio: number;
  shadowMapSize: number;
  shadowCameraFar: number;
  shadowHalfExtent: number;
  /** Total particle ring capacity across all karts (keep in sync with VFX_BUDGET). */
  vfxParticleBudget: number;
  /** Max skid-mark quad segments (keep in sync with SKID_SEGMENTS). */
  skidSegments: number;
  /** Sun glint strength on the water surface (0 disables on low tier). */
  waterGlintIntensity: number;
  /**
   * Master post-grade + vignette strength scalar (1 = full look,
   * 0 = pre-064 identity). Near-free ALU, so full (1) on every tier.
   */
  postGradeStrength: number;
  /**
   * 159 max per-effect gains for the sun light effects when the user has the
   * effect ENABLED. Kept deliberately restrained (soft painted, never neon);
   * the day-phase glow scales them further and Settings toggles gate them.
   * Non-zero on every tier so a toggle always does something (low is subtler,
   * not off). god-ray march is the priciest, so it scales the hardest.
   */
  sunHaloStrength: number;
  godRayStrength: number;
  lensFlareStrength: number;
  /**
   * 205 draw-distance / LOD-budget tier gate for the distant-rendering toolkit.
   * These scale the world-scaled terrain + dressing stream reach and the
   * streaming/LOD budgets so LOW stays within its current budget while HIGH (the
   * default) reaches farther. HIGH reproduces the pre-205 fixed constants exactly
   * (no regression on the default tier); low/med reduce them.
   */
  /** Max world-scaled terrain + dressing stream radius (metres); caps draw distance. */
  terrainDrawCap: number;
  /** Per-frame incremental chunk-seed budget: chunks activated per frame at load. */
  terrainSeedBudget: number;
  /** Terrain LOD tier-swap cross-fade duration (seconds; 0 = instant snap, low). */
  terrainCrossFadeSeconds: number;
  /** Far-decor density floor (0..1); lower thins distant scatter harder (cheaper). */
  dressingDensityMin: number;
  /**
   * 203 HLOD backdrop reach (metres) past the streamed cull ring: the coarse
   * static ring of distant terrain extends from the cull radius out to
   * cullRadius + this, so the horizon reads as real ridgelines instead of a fog
   * wall. 0 disables the backdrop entirely (low tier — cheapest, no extra draw).
   */
  terrainBackdropReach: number;
}

export const DEFAULT_QUALITY: QualityTier = "high";

const LOW_KNOBS: QualityKnobs = {
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
  terrainDrawCap: 200,
  terrainSeedBudget: 8,
  terrainCrossFadeSeconds: 0,
  dressingDensityMin: 0.25,
  terrainBackdropReach: 0,
};

const MED_KNOBS: QualityKnobs = {
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
  terrainDrawCap: 280,
  terrainSeedBudget: 12,
  terrainCrossFadeSeconds: 0.4,
  dressingDensityMin: 0.3,
  terrainBackdropReach: 160,
};

/**
 * Resolve a tier's render knobs. The device pixel ratio is passed in (not read
 * from window) so the function stays pure + testable. "high" clamps dpr to 2
 * (matches the pre-011 Renderer default); "low"/"med" are fixed and ignore
 * dpr. Throws on an unknown tier so a bad value fails loudly.
 */
export function qualityKnobs(tier: QualityTier, dpr: number): QualityKnobs {
  switch (tier) {
    case "low":
      return LOW_KNOBS;
    case "med":
      return MED_KNOBS;
    case "high":
      return {
        pixelRatio: Math.min(dpr, 2),
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
        // HIGH reproduces the pre-205 fixed constants exactly (Game's former
        // TERRAIN_DRAW_CAP=360, TERRAIN_SEED_BUDGET=16, cross-fade 0.4, dressing
        // densityMin 0.35) so the default tier does not regress.
        terrainDrawCap: 360,
        terrainSeedBudget: 16,
        terrainCrossFadeSeconds: 0.4,
        dressingDensityMin: 0.35,
        terrainBackdropReach: 220,
      };
    default: {
      const t: string = tier;
      throw new Error(`qualityKnobs: unknown tier: ${t}`);
    }
  }
}
