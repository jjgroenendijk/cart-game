/**
 * Pure TS mirror of the aerial-perspective grade folded into the CelMaterial
 * fragment behind the `AERIAL` define. Aerial (atmospheric) perspective is the
 * landscape-painting law that distant surfaces lose saturation and drift toward
 * the colour of the intervening atmosphere: warm foreground, cold blue-grey
 * distance. Exported so unit tests assert the exact values the GLSL produces
 * without spinning up WebGL, mirroring the posterizeChannel / postGrade
 * precedent (pure math, jsdom-tested; no THREE / no WebGL imports).
 *
 * The shader reuses `fogColor` as the atmosphere tint, so the mix target is the
 * same day-cycle + biome horizon colour three.js already writes each frame:
 * mood stays data (one shader, per-biome/day register), never a pass fork.
 * Applied BEFORE the linear haze mix so the world cools with distance while the
 * far edge still dissolves into full haze.
 */

/**
 * GLSL uniform declarations, spliced inside the fragment's `USE_FOG` block
 * (they reuse `fogColor` + view depth). Guarded by `AERIAL` so they compile out
 * when the define is absent (byte-identical to the pre-aerial fragment).
 */
export const AERIAL_UNIFORM_GLSL = `
  #ifdef AERIAL
  uniform float uAerialNear;
  uniform float uAerialFar;
  uniform float uAerialDesat;
  uniform float uAerialTint;
  #endif`;

/**
 * GLSL grade, spliced inside the `USE_FOG` block BEFORE the haze mix: desaturate
 * distant fragments toward luminance, then pull them toward `fogColor`, both on
 * the aerial ramp. Mirrors {@link applyAerial}; compiles out without `AERIAL`.
 */
export const AERIAL_GLSL = `
    #ifdef AERIAL
    float aerial = smoothstep(uAerialNear, uAerialFar, -vViewPos.z);
    float aerialLum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(aerialLum), aerial * uAerialDesat);
    color = mix(color, fogColor, aerial * uAerialTint);
    #endif`;

/** Tuning knobs for {@link applyAerial}; folded into the shader as uniforms. */
export interface AerialParams {
  /** View-space depth (world units) where the grade begins ramping in. */
  near: number;
  /** View-space depth where the grade reaches full strength. */
  far: number;
  /** Max desaturation toward luminance at full ramp (0 = none, 1 = grey). */
  desat: number;
  /** Max tint toward the atmosphere colour at full ramp (0 = none, 1 = full). */
  tint: number;
}

/**
 * Default aerial grade. Ramp starts nearer than the haze (fogNear 90) so
 * mid-distance already cools before geometry fully hazes; reaches full by the
 * fog far plane (360). desat/tint are restrained so the world recedes without
 * washing to flat grey — painterly depth, not a fade to nothing.
 */
export const AERIAL_DEFAULTS: AerialParams = {
  near: 45,
  far: 340,
  desat: 0.5,
  tint: 0.35,
};

/** Rec. 709 luminance weights; must match the GLSL dot() in the fragment. */
export const AERIAL_LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** GLSL `smoothstep(near, far, x)`: 0 below near, 1 above far, Hermite between. */
export function smoothstep(near: number, far: number, x: number): number {
  if (far === near) return x < near ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - near) / (far - near)));
  return t * t * (3 - 2 * t);
}

/**
 * Aerial-perspective grade for one LINEAR colour at a given view-space depth.
 * Desaturate toward the colour's own luminance, then pull toward the
 * atmosphere colour; both scaled by the depth ramp. depth <= near returns the
 * input unchanged. Bit-mirrors the `AERIAL` fragment block.
 */
export function applyAerial(
  color: readonly [number, number, number],
  depth: number,
  atmosphere: readonly [number, number, number],
  params: AerialParams = AERIAL_DEFAULTS,
): [number, number, number] {
  const a = smoothstep(params.near, params.far, depth);
  const [r, g, b] = color;
  const lum = r * AERIAL_LUMA[0] + g * AERIAL_LUMA[1] + b * AERIAL_LUMA[2];
  const dk = a * params.desat;
  const dr = r + (lum - r) * dk;
  const dg = g + (lum - g) * dk;
  const db = b + (lum - b) * dk;
  const tk = a * params.tint;
  return [
    dr + (atmosphere[0] - dr) * tk,
    dg + (atmosphere[1] - dg) * tk,
    db + (atmosphere[2] - db) * tk,
  ];
}
