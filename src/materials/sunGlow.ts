import * as THREE from "three";
import { clamp01, smoothstep } from "../core/rng";

/**
 * Pure TS mirror of the 074 sun-glow math: screen-space sun-uv projection +
 * elevation-driven sky-halo intensity. Exported so unit tests assert the
 * exact values later commits fold into the SkyPosterizePass fragment
 * without spinning up WebGL. Mirrors the postGrade.ts precedent: pure math,
 * jsdom-tested. THREE is used only for matrix/vector ops (no WebGL).
 */

/**
 * Elevation (deg) at/above which the glow halo is fully faded out. The halo
 * peaks at the horizon (dawn/dusk) and falls to 0 toward high noon; this is
 * the smoothstep ceiling of that falloff.
 */
const GLOW_FALLOFF_ELEV = 35;

/**
 * Day-peak sun intensity the glow brightness is normalized against
 * (matches `src/environment/dayCycle.ts` SUN_INTENSITY day = 2.0).
 */
const GLOW_DAY_PEAK = 2.0;

/**
 * Screen-space sun position + visibility. `uv` is in [0,1]^2 (NDC mapped to
 * texture space); `visible` is false when the sun is behind the camera or its
 * projected position is off-screen. When not visible, `uv` is the safe center
 * default (0.5, 0.5); consumers MUST check `visible` before using `uv`.
 */
export interface SunUv {
  /** Sun position in screen UV space ([0,1]^2); center default when hidden. */
  uv: { x: number; y: number };
  /** False when the sun is behind the camera or off-screen. */
  visible: boolean;
}

/**
 * Project the world-space sun direction onto the camera's screen UV space.
 * The sun is effectively at infinity, so a point is placed along
 * `sunDirWorld` at the camera's far-plane distance, then transformed
 * through eye space and clip space manually (mirrors THREE.Vector3.project
 * but keeps clip `w` for a robust behind-camera test). Does NOT mutate
 * `sunDirWorld`. Returns a fresh {@link SunUv} each call (no pooling).
 *
 * Behind-camera: clip `w <= 0` (point behind the near plane). Off-screen:
 * NDC xy outside [-1, 1]. In both cases `visible` is false and `uv` is the
 * center default.
 */
export function projectSunUv(sunDirWorld: THREE.Vector3, camera: THREE.Camera): SunUv {
  const far = (camera as THREE.PerspectiveCamera).far;
  const p = sunDirWorld.clone().multiplyScalar(far);
  const clip = new THREE.Vector4(p.x, p.y, p.z, 1)
    .applyMatrix4(camera.matrixWorldInverse)
    .applyMatrix4(camera.projectionMatrix);

  if (clip.w <= 0) {
    return { uv: { x: 0.5, y: 0.5 }, visible: false };
  }

  const inv = 1 / clip.w;
  const ndcX = clip.x * inv;
  const ndcY = clip.y * inv;

  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) {
    return { uv: { x: 0.5, y: 0.5 }, visible: false };
  }

  return {
    uv: { x: ndcX * 0.5 + 0.5, y: ndcY * 0.5 + 0.5 },
    visible: true,
  };
}

/**
 * Scalar in [0,1] for how strong the sky halo / sun glow reads. Peaks at low
 * sun elevation (dawn/dusk near the horizon) and fades to 0 toward high noon
 * via `1 - smoothstep(0, GLOW_FALLOFF_ELEV, max(0, elevDeg))`; 0 in full
 * night (`1 - nightFactor`), 0 when the sun is dim, 0 when the tier knob is
 * off. Below-horizon elevation does not hard-clip (the night fade owns the
 * dark side). Mirrors the elevation/intensity conventions of
 * `src/environment/dayCycle.ts` (MAX_ELEV 62, SUN_INTENSITY day 2.0,
 * nightFactor 0..1). Pure plain-Math; no THREE.
 */
export function glowIntensity(
  elevDeg: number,
  sunIntensity: number,
  nightFactor: number,
  tierScale: number,
): number {
  const elevFactor = 1 - smoothstep(0, GLOW_FALLOFF_ELEV, Math.max(0, elevDeg));
  const nightFade = 1 - clamp01(nightFactor);
  const intensityFactor = clamp01(sunIntensity / GLOW_DAY_PEAK);
  const tier = clamp01(tierScale);
  return clamp01(elevFactor * nightFade * intensityFactor * tier);
}
