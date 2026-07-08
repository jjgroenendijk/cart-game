import { smoothstep } from "../core/rng";

/**
 * Pure TS mirror of the 064 post-grade math (vignette + day-phase grade),
 * the finishing ops a later commit folds into SkyPosterizePass's fragment
 * shader. Exported so unit tests assert the exact values the GLSL will
 * produce without spinning up WebGL. Mirrors the posterizeChannel precedent
 * (skyPosterize.ts): pure math, jsdom-tested. No THREE / no WebGL imports.
 */

/**
 * cycleT positions of the four phase keyframes: [dawn, day, dusk, night].
 * Mirrors dayCycle.ts KEY_TS and its index order so GRADE_TABLE aligns with
 * the same phase blend the sky tints ride.
 */
const KEY_TS: readonly number[] = [0, 0.25, 0.5, 0.75];

/**
 * Distance from screen center (0.5, 0.5) to a corner (0,0)/(1,1) in UV
 * space = sqrt(0.5^2 + 0.5^2) = 1/sqrt(2). Cap of the vignette radius ramp.
 */
const CORNER_DIST = Math.SQRT1_2;

/**
 * Day-phase color grade applied uniformly to every pixel after posterize,
 * before vignette. All three fields are deltas where 0 = no change
 * (identity). Driven by {@link gradeForCycleT} from the day-cycle phase mix.
 */
export interface Grade {
  /**
   * Saturation delta. Multiplies color toward gray: negative = desaturate,
   * positive = saturate. 0 = unchanged.
   */
  saturation: number;
  /**
   * Warmth delta. Shifts red up / blue down: positive = warm, negative =
   * cool. 0 = unchanged.
   */
  warmth: number;
  /**
   * Lift delta. Raises blacks: positive = lift crushed blacks for
   * readability, negative = crush. 0 = unchanged.
   */
  lift: number;
}

/**
 * Per-phase grade targets (064 look): indices [dawn, day, dusk, night].
 * day = identity. dawn/dusk warm +6% sat. night desaturated -15%, cool
 * -0.05, lifted +0.01 so crushed blacks stay readable.
 */
const GRADE_TABLE: readonly Grade[] = [
  { saturation: 0.06, warmth: 0.04, lift: 0 },
  { saturation: 0, warmth: 0, lift: 0 },
  { saturation: 0.06, warmth: 0.04, lift: 0 },
  { saturation: -0.15, warmth: -0.05, lift: 0.01 },
];

/**
 * Keyframe segment + smoothstep blend factor for a normalized cycle time.
 * Mirrors dayCycle.ts segmentBlend; reimplemented here to keep this module
 * WebGL-free + jsdom-pure. Wrap segment blends night (t=0.75) -> dawn
 * (t=1==0) over the last 0.25; otherwise the first segment whose upper
 * bound exceeds cycleT.
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
 * Interpolate {@link GRADE_TABLE}'s three fields across the smoothstep
 * segment blend for a cycle time. Pure; returns a fresh Grade (callers read
 * immediately, no pooling). day (cycleT=0.25) yields identity; dusk/dawn
 * warm +6% sat; night desaturated/cool/lifted. Cross-fades exactly like the
 * dayCycle sky tints (same phase blend).
 */
export function gradeForCycleT(cycleT: number): Grade {
  const { from, to, s } = segmentBlend(cycleT);
  const a = GRADE_TABLE[from]!;
  const b = GRADE_TABLE[to]!;
  return {
    saturation: a.saturation + (b.saturation - a.saturation) * s,
    warmth: a.warmth + (b.warmth - a.warmth) * s,
    lift: a.lift + (b.lift - a.lift) * s,
  };
}

/**
 * Pure mirror of the GLSL vignette. Returns an rgb multiplier (1 =
 * unchanged, <1 = darkened). d mirrors GLSL `length(vUv - vec2(0.5))`. At
 * center d=0 -> factor 1; at a corner d=CORNER_DIST -> smoothstep hits 1 ->
 * factor = 1 - strength (so strength=0.12 ~= 12% corner darkening). radius
 * = distance from center where darkening begins (larger = wider clear
 * center). strength=0 -> factor 1 everywhere (identity/off).
 */
export function vignetteFactor(uvX: number, uvY: number, strength: number, radius: number): number {
  const d = Math.sqrt((uvX - 0.5) ** 2 + (uvY - 0.5) ** 2);
  return 1 - strength * smoothstep(radius, CORNER_DIST, d);
}

/** Default vignette corner darkening (~12% at the corners; 064 look). */
export const DEFAULT_VIGNETTE_STRENGTH = 0.12;

/** Default vignette clear-center radius (wide; 064 look). */
export const DEFAULT_VIGNETTE_RADIUS = 0.35;
