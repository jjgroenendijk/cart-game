/**
 * 159 pure sun-projection + glow-intensity math for the analytic light
 * effects (sun halo, god rays, lens flare) composited in SkyPosterizePass.
 * No post-processing state and no WebGL: projectSunUv needs only a THREE
 * Camera's matrices, so this whole module runs under jsdom unit tests. The
 * Renderer calls these per frame; the pass owns the uniforms + GLSL.
 *
 * The effects are intentionally NOT HDR bloom (the retired 074 UnrealBloom
 * approach whited out the cel look). They are cheap additive sRGB terms in
 * the existing final pass, each gated by an effectGain that a Settings
 * toggle can drive to 0.
 */

import * as THREE from "three";

/** Distance along the sun direction used as the projected point (sun ~ at infinity). */
const SUN_FAR = 5000;

const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _view = new THREE.Vector3();
const _ndc = new THREE.Vector3();

/** Projected sun screen position: uv in [0,1] plus whether it is in front. */
export interface SunScreen {
  /** Horizontal screen uv (0 = left, 1 = right). Meaningful only when `front`. */
  u: number;
  /** Vertical screen uv (0 = bottom, 1 = top). Meaningful only when `front`. */
  v: number;
  /** True when the sun is in front of the camera (behind -> no halo/flare). */
  front: boolean;
}

/**
 * Project the world sun DIRECTION to a screen uv for `camera`. The sun is a
 * directional light (a point at infinity), so a point far along the direction
 * from the camera is projected. `front` is resolved from the view-space z sign
 * (camera looks down -Z) independently of the ndc perspective divide, which
 * flips sign for points behind the camera. Refreshes matrixWorld +
 * matrixWorldInverse locally so it does not depend on renderer-managed state.
 */
export function projectSunUv(sunDir: THREE.Vector3, camera: THREE.Camera): SunScreen {
  _p.copy(sunDir).multiplyScalar(SUN_FAR).add(camera.position);
  camera.updateMatrixWorld();
  _inv.copy(camera.matrixWorld).invert();
  _view.copy(_p).applyMatrix4(_inv);
  const front = _view.z < 0;
  _ndc.copy(_p).applyMatrix4(_inv).applyMatrix4(camera.projectionMatrix);
  return { u: _ndc.x * 0.5 + 0.5, v: _ndc.y * 0.5 + 0.5, front };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Master day-phase weight (0..1) for the sun effects. 0 at/below night (the
 * sun is set), rising into day, and strongest at LOW sun elevation (the
 * dawn/dusk golden-hour rake) so the halo + shafts read most near the
 * horizon. `sunIntensity` is the DirectionalLight intensity (~0..2); 0 forces
 * the whole term to 0 so nothing glows when the sun contributes no light.
 */
export function glowIntensity(elevDeg: number, sunIntensity: number, nightFactor: number): number {
  if (sunIntensity <= 0) return 0;
  const day = clamp01(1 - nightFactor);
  // 1 at the horizon, fading to 0 by ~50deg elevation (noon). Never fully to 0
  // via the 0.45 floor so a high sun still carries a faint glow.
  const horizon = clamp01(1 - Math.max(elevDeg, 0) / 50);
  const base = 0.45 + 0.55 * horizon;
  return clamp01(day * base * clamp01(sunIntensity / 2));
}

/**
 * Final per-effect uniform gain: 0 when the user disabled the effect,
 * otherwise the tier strength scaled by the shared day-phase {@link
 * glowIntensity}. Keeping this pure lets the Renderer stay a thin caller and
 * the shader identity path (gain 0) is exact.
 */
export function effectGain(strength: number, enabled: boolean, glow: number): number {
  return enabled ? strength * glow : 0;
}
