/**
 * 159 sun-effect per-frame state (split from Renderer for the file-size cap;
 * behavior unchanged). Owns the user enables + tier strengths, the
 * once-per-frame glow weight + sRGB sun tint, and the per-view apply that
 * binds them to a SkyPosterizePass. Renderer resolves once per frame in
 * applyDayCycle, then fans apply() per view in renderViews.
 */

import * as THREE from "three";
import { applySunEffects, type SunFxConfig } from "../materials/sunEffects";
import { glowIntensity } from "../materials/sunGlow";
import type { SkyPosterizePass } from "../materials/skyPosterize";
import type { DayCycleState } from "../environment/dayCycle";

/**
 * Per-frame sun-effect state consumed by applySunEffects. Strengths arrive via
 * setStrengths (from setQuality); enables via setEnables (from setEffects).
 * groundMist defaults true so the 228 valley mist pass is on until Game
 * applies settings; _fxGlow + _sunColorSrgb are resolved once per frame.
 */
export class SunFxState {
  private readonly _fxConfig: SunFxConfig = {
    enables: { sunHalo: false, godRays: false, lensFlare: false, groundMist: true },
    strengths: { halo: 0, godray: 0, flare: 0 },
  };
  private _fxGlow = 0;
  private readonly _sunColorSrgb = new THREE.Color();

  /** Tier-resolved max per-effect strengths (from setQuality). */
  setStrengths(halo: number, godray: number, flare: number): void {
    this._fxConfig.strengths.halo = halo;
    this._fxConfig.strengths.godray = godray;
    this._fxConfig.strengths.flare = flare;
  }

  /** Per-effect user enables (from Settings, via setEffects). */
  setEnables(sunHalo: boolean, godRays: boolean, lensFlare: boolean, groundMist: boolean): void {
    this._fxConfig.enables.sunHalo = sunHalo;
    this._fxConfig.enables.godRays = godRays;
    this._fxConfig.enables.lensFlare = lensFlare;
    this._fxConfig.enables.groundMist = groundMist;
  }

  /**
   * Resolve the shared day-phase glow weight (0 at night) + sRGB sun tint once
   * per frame; apply() fans them per view. Camera-independent by design.
   */
  resolveFrame(state: DayCycleState): void {
    this._fxGlow = glowIntensity(state.sunElevationDeg, state.sunIntensity, state.nightFactor);
    this._sunColorSrgb.copy(state.sunColor).convertLinearToSRGB();
  }

  /** Whether the 228 ground-mist pass should run this frame (Renderer scales). */
  groundMistEnabled(): boolean {
    return this._fxConfig.enables.groundMist;
  }

  /**
   * Project the sun for `camera` and write every 159 sun-effect uniform onto
   * `pass`. `aspect` = view width / height (caller guards div-by-zero).
   */
  apply(
    pass: SkyPosterizePass,
    camera: THREE.Camera,
    sunDirWorld: THREE.Vector3,
    aspect: number,
  ): void {
    applySunEffects(
      pass,
      camera,
      sunDirWorld,
      aspect,
      this._sunColorSrgb,
      this._fxGlow,
      this._fxConfig,
    );
  }
}
