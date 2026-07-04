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
};

const MED_KNOBS: QualityKnobs = {
  pixelRatio: 1.5,
  shadowMapSize: 2048,
  shadowCameraFar: 200,
  shadowHalfExtent: 80,
  vfxParticleBudget: 1536,
  skidSegments: 512,
  waterGlintIntensity: 1,
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
      };
    default: {
      const t: string = tier;
      throw new Error(`qualityKnobs: unknown tier: ${t}`);
    }
  }
}
