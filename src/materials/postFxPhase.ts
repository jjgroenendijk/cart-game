import { smoothstep } from "../core/rng";

/**
 * Pure TS mirror of the lighting-glow-up Phase 1 post-FX math: day-phase
 * bloom + exposure targets and the godray phase/screen-fade weights. Sibling
 * of {@link postGrade}: same keyframe segment blend, no THREE / no WebGL /
 * no DOM, jsdom-tested. A later commit folds these into the Renderer's
 * composer uniforms; exported so unit tests assert the exact values the
 * GLSL will produce without spinning up WebGL.
 */

/**
 * cycleT positions of the four phase keyframes: [dawn, day, dusk, night].
 * Mirrors dayCycle.ts + postGrade.ts KEY_TS so the phase blend aligns with
 * the sky tints and the post-grade triplet.
 */
const KEY_TS: readonly number[] = [0, 0.25, 0.5, 0.75];

/**
 * Keyframe segment + smoothstep blend factor for a normalized cycle time.
 * Mirrors postGrade.ts segmentBlend; reimplemented here to keep this module
 * WebGL-free + jsdom-pure. Wraps the night (t=0.75) -> dawn (t=1==0) blend
 * over the last 0.25; otherwise the first segment whose upper bound exceeds
 * cycleT.
 */
function segmentBlend(cycleT: number): { from: number; to: number; s: number } {
  if (cycleT >= KEY_TS[3]) {
    return { from: 3, to: 0, s: smoothstep(0, 1, (cycleT - KEY_TS[3]) / 0.25) };
  }
  for (let i = 0; i < 3; i++) {
    if (cycleT < KEY_TS[i + 1]) {
      const span = KEY_TS[i + 1] - KEY_TS[i];
      return { from: i, to: i + 1, s: smoothstep(0, 1, (cycleT - KEY_TS[i]) / span) };
    }
  }
  return { from: 3, to: 3, s: 0 };
}

/**
 * HDR bloom parameters fed to the composer's UnrealBloomPass (or its
 * successor): strength scales the bloomed add-back, radius is the blur
 * kernel spread, threshold is the raw LINEAR luminance above which a pixel
 * contributes to the bloom buffer.
 */
export interface BloomParams {
  /** Bloom add-back gain (0 = off). Scaled per quality tier. */
  strength: number;
  /** Blur kernel spread; larger = wider, softer glow. */
  radius: number;
  /** Raw LINEAR luminance cutoff; only pixels above this bloom. */
  threshold: number;
}

/**
 * Per-phase bloom targets (indices [dawn, day, dusk, night]). day sits high
 * (threshold 2.1) so only true HDR emitters bloom under a full sky; dawn/dusk
 * drop to 1.5 so the low sun + warm rim light glows; night drops to 0.7 so
 * headlights/taillights and the boosted SunDisc core bloom. Strength tracks
 * the same shape (day dimmer, dawn/dusk warmer). Radius is phase-agnostic.
 */
const THRESHOLD_TABLE: readonly number[] = [1.5, 2.1, 1.5, 0.7];
const STRENGTH_TABLE: readonly number[] = [0.55, 0.3, 0.55, 0.45];

/** Fixed bloom blur radius across all phases (the 064 look constant). */
const BLOOM_RADIUS = 0.35;

/**
 * Interpolate the phase-driven bloom triplet across the smoothstep segment
 * blend for a cycle time, then scale strength by tierScale (0 = pass off,
 * 0.85 = med, 1 = high). radius is phase-agnostic (constant). Returns a
 * fresh BloomParams each call (no pooling; callers read immediately).
 */
export function bloomForCycleT(cycleT: number, tierScale: number): BloomParams {
  const { from, to, s } = segmentBlend(cycleT);
  const tA = THRESHOLD_TABLE[from]!;
  const tB = THRESHOLD_TABLE[to]!;
  const sA = STRENGTH_TABLE[from]!;
  const sB = STRENGTH_TABLE[to]!;
  return {
    strength: (sA + (sB - sA) * s) * tierScale,
    radius: BLOOM_RADIUS,
    threshold: tA + (tB - tA) * s,
  };
}

/**
 * Per-phase exposure targets (indices [dawn, day, dusk, night]): day brightest
 * (+6%), night darkest (-8%), dawn/dusk slightly under-neutral. Drives an
 * exposure multiplier on the HDR/tonemap path.
 */
const EXPOSURE_TABLE: readonly number[] = [0.97, 1.06, 0.97, 0.92];

/**
 * Interpolate the phase-driven exposure scalar across the smoothstep segment
 * blend for a cycle time. day (cycleT=0.25) -> 1.06 (brightest); night
 * (cycleT=0.75) -> 0.92 (darkest). Pure; returns a single number.
 */
export function exposureForCycleT(cycleT: number): number {
  const { from, to, s } = segmentBlend(cycleT);
  const a = EXPOSURE_TABLE[from]!;
  const b = EXPOSURE_TABLE[to]!;
  return a + (b - a) * s;
}

/**
 * Godray phase strength for a sun elevation in degrees. Full strength while
 * the sun sits 4-18 deg above the horizon (dawn/dusk crepuscular window);
 * fades in below 4 deg, fades out above 18 deg, zero at night (below -3) and
 * at high noon (above 45). Clamped to [0, 1].
 */
export function godrayPhaseStrength(elevDeg: number): number {
  const rise = smoothstep(-3, 4, elevDeg);
  const set = smoothstep(18, 45, elevDeg);
  const v = rise * (1 - set);
  return Math.max(0, Math.min(1, v));
}

/**
 * Godray screen-space fade from the sun's UV position. Returns 0 when the sun
 * is off-screen (visible=false). Otherwise fades as the sun nears a screen
 * edge: full strength (1) when centered, ~0 once `max(|x-0.5|,|y-0.5|)*2`
 * crosses the 0.7->1.0 ramp (cheeks of the frame).
 */
export function godrayScreenFade(
  sunScreenUvX: number,
  sunScreenUvY: number,
  visible: boolean,
): number {
  if (!visible) return 0;
  const edge = Math.max(Math.abs(sunScreenUvX - 0.5), Math.abs(sunScreenUvY - 0.5)) * 2;
  return 1 - smoothstep(0.7, 1.0, edge);
}
