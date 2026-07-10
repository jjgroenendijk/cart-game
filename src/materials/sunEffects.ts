/**
 * 159 per-view applier that binds the pure sun-glow math (sunGlow.ts) to a
 * SkyPosterizePass. Kept out of both sunGlow.ts (which stays pure/WebGL-free)
 * and Renderer.ts (which stays a thin caller under its 600-line cap): the
 * Renderer computes the day-phase glow + sRGB sun color once per frame, then
 * calls this once per view/slot with the bound camera.
 */

import type * as THREE from "three";
import type { SkyPosterizePass } from "./skyPosterize";
import type { EffectSettings } from "../core/settings";
import { effectGain, projectSunUv } from "./sunGlow";

/** Enabled flags + this tier's max per-effect strengths. */
export interface SunFxConfig {
  enables: EffectSettings;
  strengths: { halo: number; godray: number; flare: number };
}

/**
 * Project the sun for `camera` and write every 159 sun-effect uniform onto
 * `pass`. `glow` is the shared day-phase weight (0 at night). Each gain is
 * `effectGain(strength, enabled, glow)`, so a disabled effect writes 0 and the
 * pass stays a byte-identical no-op. `aspect` = view width / height.
 */
export function applySunEffects(
  pass: SkyPosterizePass,
  camera: THREE.Camera,
  sunDirWorld: THREE.Vector3,
  aspect: number,
  sunColorSrgb: THREE.Color,
  glow: number,
  cfg: SunFxConfig,
): void {
  const sun = projectSunUv(sunDirWorld, camera);
  pass.setSunEffects(
    sun.u,
    sun.v,
    sun.front,
    aspect,
    sunColorSrgb,
    effectGain(cfg.strengths.halo, cfg.enables.sunHalo, glow),
    effectGain(cfg.strengths.godray, cfg.enables.godRays, glow),
    effectGain(cfg.strengths.flare, cfg.enables.lensFlare, glow),
  );
}
