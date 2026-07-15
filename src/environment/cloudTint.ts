import * as THREE from "three";
import type { SkyPhase } from "./dayCycle";

/** Default cloud base tint (sRGB). */
export const CLOUD_BASE_TINT = 0xf2f4f8;

/**
 * Per-phase cloud-tint blend factor toward the live `skyHorizon`. day stays
 * base white; dawn/dusk warm toward the horizon tint (pink/amber); night
 * darkens (the night horizon keyframe is already a dark blue-gray so clouds
 * barely read against the sky). Exported for tests + tuning.
 */
export const CLOUD_TINT_BLEND: Readonly<Record<SkyPhase, number>> = {
  dawn: 0.45,
  day: 0,
  dusk: 0.45,
  night: 0.3,
};

/**
 * Far-band (#204) tint blend toward the live `skyHorizon`. Much stronger than
 * {@link CLOUD_TINT_BLEND} in EVERY phase — including day — because the far band
 * hangs LOW on the horizon (radius 240, alt ~63). A pure-white bank there reads
 * as a solid ridge against a warm biome horizon (desert fogTint 0xe8cf9a). Pull
 * it hard toward the horizon color so it dissolves into the sky as haze instead
 * of a hard white dome, while the high near puffs stay white overhead.
 */
export const FAR_BAND_TINT_BLEND: Readonly<Record<SkyPhase, number>> = {
  dawn: 0.72,
  day: 0.6,
  dusk: 0.72,
  night: 0.5,
};

/**
 * Lerp `base` toward `skyHorizon` by `blend` into `out` (mutated + returned).
 * blend <= 0 copies base unshifted. Never mutates `skyHorizon`/`base`.
 */
export function tintTowardHorizon(
  blend: number,
  skyHorizon: THREE.Color,
  base: THREE.Color,
  out: THREE.Color,
): THREE.Color {
  if (blend <= 0) return out.copy(base);
  return out.copy(base).lerp(skyHorizon, blend);
}

/**
 * Pure cloud-tint blend for 014. Lerps a cloud base tint toward the live
 * `skyHorizon` keyframe color by a per-phase factor. Same inputs -> same
 * output; never mutates `skyHorizon` or `base`. jsdom-safe (Color math only).
 * The `out` color is mutated + returned (mirrors applyDayCycleToTargets).
 */
export function cloudTintFor(
  phase: SkyPhase,
  skyHorizon: THREE.Color,
  base: THREE.Color,
  out: THREE.Color,
): THREE.Color {
  return tintTowardHorizon(CLOUD_TINT_BLEND[phase], skyHorizon, base, out);
}

/**
 * Far-band variant of {@link cloudTintFor}: blends by {@link FAR_BAND_TINT_BLEND}
 * so the low horizon band always sits in the horizon color, never a white ridge.
 */
export function farBandTintFor(
  phase: SkyPhase,
  skyHorizon: THREE.Color,
  base: THREE.Color,
  out: THREE.Color,
): THREE.Color {
  return tintTowardHorizon(FAR_BAND_TINT_BLEND[phase], skyHorizon, base, out);
}
