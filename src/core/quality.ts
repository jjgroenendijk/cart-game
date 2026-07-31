/**
 * 011 quality-tier knob set. Pure mapping from a QualityTier + the device's
 * pixel ratio to the Renderer's pixelRatio + per-cascade shadow extents (near +
 * optional far: map sizes, camera far planes, ortho half-extents). No Three.js
 * or WebGL types: QualityKnobs carries plain numbers so this module runs under
 * jsdom unit tests. Renderer.setQuality applies a tier's knobs to the live
 * WebGLRenderer + sun shadow camera and rebuilds the shadow map on change; the
 * default tier "high" reproduces the Renderer's pre-011 look (012 wires user
 * choice).
 *
 * Pure: no Three, no WebGL, no DOM, no side effects. Fully unit tested.
 */

import { clamp } from "./math";

export type QualityTier = "low" | "med" | "high";

export interface QualityKnobs {
  pixelRatio: number;
  shadowMapSize: number;
  shadowCameraFar: number;
  shadowHalfExtent: number;
  /**
   * 144 far (2nd) shadow cascade map size (square, texels). 0 disables the far
   * cascade entirely -> single near box (low tier: byte-identical to pre-144).
   * med 1024, high 2048.
   */
  farShadowMapSize: number;
  /**
   * 144 far cascade ortho half-extent (metres); 0 when the far cascade is off.
   * Covers middle distance to the terrain draw range so distant trees cast.
   */
  farShadowHalfExtent: number;
  /**
   * 144 far cascade shadow-camera far plane (metres); 0 when off. Large enough to
   * reach the ground from the sun-positioned light over the wider far box.
   */
  farShadowCameraFar: number;
  /**
   * 144 view-space distance (metres) from the camera at which the far cascade is
   * fully selected (blend weight = 1). Sits near the near cascade's half-extent.
   * 0 on low (single cascade, helper returns weight 0).
   */
  cascadeSplit: number;
  /**
   * 144 width (metres) of the near->far blend band ending at {@link cascadeSplit}.
   * 0 on low (hard single cascade). Sharpness of the seam; ~10% of the split.
   */
  cascadeBlendWidth: number;
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
   * 228 master gain (0..1) for the valley ground-mist post pass. 0 on low
   * (off/identity); med 0.5; high 1.0. Mirrors waterGlintIntensity:0-on-low.
   */
  groundMistStrength: number;
  /**
   * 235 master gain (0..1) for the GTAO ambient occlusion pass. 0 on low
   * (off/identity); med 0.5; high 1.0. Mirrors groundMistStrength:0-on-low.
   */
  aoStrength: number;
  /**
   * 235 GTAO slice count (3..6). Lower = cheaper; low tier is 0 since AO is
   * off there. Drives the GLSL horizon-search loop bound (max 6).
   */
  aoSlices: number;
  /**
   * 231 HDR bloom master strength (0 = pass absent/identity on low tier;
   * med 0.35, high 0.5). Only pixels >1.0 pre-tonemap bloom.
   */
  bloomStrength: number;
  /**
   * 231 bloom cost gate: med renders bloom at half composer resolution
   * (cheaper); high full. Low is irrelevant (pass absent).
   */
  bloomHalfRes: boolean;
  /**
   * 232 SMAA anti-aliasing enable. true on every tier: the EffectComposer path
   * renders to render targets, so the WebGL context's `antialias` MSAA never
   * touches the post-processed image (the scene currently has no AA at all
   * through the composer). SMAA is cheap + stateless, so it ships on; the knob
   * lets a constrained device disable it. Renderer gates the SMAAPass via
   * pass.enabled = smaa.
   */
  smaa: boolean;
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
   * 203 HLOD backdrop reach (metres) past the streamed cull ring: a coarse
   * static ring of distant terrain from the cull radius out to cullRadius + this
   * so the horizon can read as real ridgelines instead of a fog wall. 0 disables
   * the backdrop (no extra draw). Currently 0 on EVERY tier — the ring read as
   * dark near-horizon "mountains" rather than receding haze, so it ships off; the
   * TerrainBackdrop code stays dormant (opt-in) until the look is retuned.
   */
  terrainBackdropReach: number;
  /**
   * 283 procedural sky environment capture cube size (square pixels per face).
   * 0 disables the capture entirely (low tier: flat ambient unchanged, no
   * SKY_ENV define). med 64, high 128. Mirrors aoStrength:0-on-low.
   */
  skyEnvSize: number;
}

export const DEFAULT_QUALITY: QualityTier = "high";

const LOW_KNOBS: QualityKnobs = {
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
  sunHaloStrength: 0.12,
  godRayStrength: 0.2,
  lensFlareStrength: 0.3,
  groundMistStrength: 0,
  aoStrength: 0,
  aoSlices: 0,
  bloomStrength: 0,
  bloomHalfRes: false,
  smaa: true,
  terrainDrawCap: 200,
  terrainSeedBudget: 8,
  terrainCrossFadeSeconds: 0,
  dressingDensityMin: 0.25,
  terrainBackdropReach: 0,
  skyEnvSize: 0, // 283 capture off (flat ambient unchanged)
};

const MED_KNOBS: QualityKnobs = {
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
  sunHaloStrength: 0.18,
  godRayStrength: 0.35,
  lensFlareStrength: 0.4,
  groundMistStrength: 0.5,
  aoStrength: 0.5,
  aoSlices: 3,
  bloomStrength: 0.35,
  bloomHalfRes: true,
  smaa: true,
  terrainDrawCap: 280,
  terrainSeedBudget: 12,
  terrainCrossFadeSeconds: 0.4,
  dressingDensityMin: 0.3,
  terrainBackdropReach: 0, // 203 backdrop shipped off (read as dark mountains)
  skyEnvSize: 64, // 283 sky env capture
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
        sunHaloStrength: 0.22,
        godRayStrength: 0.5,
        lensFlareStrength: 0.5,
        groundMistStrength: 1,
        aoStrength: 1,
        aoSlices: 6,
        bloomStrength: 0.5,
        bloomHalfRes: false,
        smaa: true,
        // HIGH reproduces the pre-205 fixed constants exactly (Game's former
        // TERRAIN_DRAW_CAP=360, TERRAIN_SEED_BUDGET=16, cross-fade 0.4, dressing
        // densityMin 0.35) so the default tier does not regress.
        terrainDrawCap: 360,
        terrainSeedBudget: 16,
        terrainCrossFadeSeconds: 0.4,
        dressingDensityMin: 0.35,
        terrainBackdropReach: 0, // 203 backdrop shipped off (read as dark mountains)
        skyEnvSize: 128, // 283 sky env capture
      };
    default: {
      const t: string = tier;
      throw new Error(`qualityKnobs: unknown tier: ${t}`);
    }
  }
}

/** 202/203/205 terrain + dressing stream reach derived from a tier + world. */
export interface StreamPlan {
  /** World-scaled activate radius (metres), capped by the tier's terrainDrawCap. */
  streamRadius: number;
  /** Deactivate radius (hysteresis past streamRadius). */
  cullRadius: number;
  /** HLOD backdrop ring past the cull ring; undefined when the tier reach is 0. */
  backdrop?: { innerRadius: number; outerRadius: number };
}

/**
 * Derive the terrain/dressing stream radii + optional HLOD backdrop ring from a
 * tier's knobs and the circuit world size. Pure (no DOM). Stream reach scales to
 * the world but is capped by terrainDrawCap so LOW streams a nearer horizon than
 * HIGH; small worlds keep the compact near ring (140/170). The backdrop extends
 * past the cull ring by terrainBackdropReach (0 => no backdrop, low tier).
 */
export function resolveStreamPlan(knobs: QualityKnobs, worldSize: number): StreamPlan {
  const drawCap = knobs.terrainDrawCap;
  const halfExtent = worldSize / 2;
  const streamRadius = clamp(halfExtent, 140, drawCap);
  const cullRadius = clamp(halfExtent + 30, 170, drawCap + 30);
  const reach = knobs.terrainBackdropReach;
  const backdrop =
    reach > 0 ? { innerRadius: cullRadius, outerRadius: cullRadius + reach } : undefined;
  return { streamRadius, cullRadius, backdrop };
}
