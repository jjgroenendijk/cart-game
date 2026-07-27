/**
 * 228 volumetric ground mist: pure value-noise fbm that drives a screen-space
 * height-based valley-mist pass (GroundMistPass). Pure module: no Three.js,
 * no WebGL, no DOM — runs under jsdom. The JS hash2/vnoise/fbm mirror the
 * exported GLSL bit-for-bit so a unit test locks the algorithm; the GLSL apply
 * is asserted by source-substring tests (no GPU in CI). The mirror follows
 * terrainDetail.ts (069) verbatim — same HASH_C, same smoothstep-interpolated
 * value noise — so surface detail and ground mist share one fingerprint.
 *
 * mistTimeFactor mirrors sunGlow.glowIntensity's dawn/dusk-peaked shape:
 * horizon weight (1 at elev 0, fading by ~30 deg) times a day weight from the
 * shared nightFactor, with a midday floor so high noon keeps a faint haze.
 */

const HASH_C = 43758.5453123;

function fract(v: number): number {
  return v - Math.floor(v);
}

export function hash2(x: number, y: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7) * HASH_C);
}

export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const c00 = hash2(ix, iy);
  const c10 = hash2(ix + 1, iy);
  const c01 = hash2(ix, iy + 1);
  const c11 = hash2(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = c00 + (c10 - c00) * ux;
  const b = c01 + (c11 - c01) * ux;
  return a + (b - a) * uy;
}

export function fbm(x: number, y: number, octaves: number): number {
  const n = Math.max(1, Math.round(octaves));
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    sum += vnoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * GLSL mirror of the {@link hash2}/{@link vnoise}/{@link fbm} trio. Copied
 * verbatim from terrainDetail.DETAIL_NOISE_FN (069) so both passes share the
 * same noise fingerprint. The fbm loop bound is the int `octaves` param
 * (constant-folded at the call site via MIST_OCTAVES).
 */
export const MIST_NOISE_FN = /* glsl */ `
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * ${HASH_C});
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float c00 = hash2(i + vec2(0.0, 0.0));
  float c10 = hash2(i + vec2(1.0, 0.0));
  float c01 = hash2(i + vec2(0.0, 1.0));
  float c11 = hash2(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(c00, c10, u.x), mix(c01, c11, u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;
  for (int i = 0; i < octaves; i++) {
    sum += vnoise(p * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}
`;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 228 dawn/dusk time weight for ground mist (0..1). Mirrors
 * sunGlow.glowIntensity's shape: 0 in deep night (nightFactor 1), densest near
 * the horizon (|elev| small), fading to a 0.35 midday floor as the sun climbs.
 * The Renderer resolves this once per frame from the day-cycle sun elevation
 * and nightFactor and passes the result to GroundMistPass.setMist (uTimeFactor).
 */
export function mistTimeFactor(sunElevationDeg: number, nightFactor: number): number {
  if (nightFactor >= 1) return 0; // deep night: no mist
  const day = clamp01(1 - nightFactor); // 1 in day, 0 deep night
  // Horizon weight: 1 at elev 0, fading to 0 by ~30 deg elevation.
  const horizon = clamp01(1 - Math.max(sunElevationDeg, 0) / 30);
  const base = 0.35 + 0.65 * horizon; // midday floor 0.35
  return clamp01(day * base);
}

/**
 * 228 humidity density multiplier from the weather wetness channel (0..1).
 * Wetness is the proxy for "humidity": rain wets the ground and thickens the
 * haze up to ~1.6x. Kept in lockstep with the GLSL wetness factor in
 * GroundMistPass (1.0 + 0.6 * clamp(wetness, 0, 1)) by comment.
 */
export function mistWetnessBoost(wetness: number): number {
  return 1 + 0.6 * clamp01(wetness);
}

/**
 * 228 ground-mist look tunables. Easily retuned by eye; these only seed the
 * pass ctor defaults and the matching uniforms. thinY clears the track/kart
 * corridor: track Y is roughly [-2, +3] and karts reach ~+5 on jumps, so the
 * haze pools below the racing line and never hides the track or nearby karts
 * (issue #228: "never hide the track or nearby karts").
 */
export interface GroundMistParams {
  /** World Y where mist is densest (at/below). Valleys/basins/water edges. */
  poolY: number;
  /** World Y above which mist thins to 0. Clears the track/kart corridor. */
  thinY: number;
  /** Mist fades in over this near-distance range (m) so close karts stay clear. */
  nearFadeStart: number;
  nearFadeEnd: number;
  /** fbm domain scale on world XZ (lower = larger drift patches). */
  fbmScale: number;
  /** Drift speed (world units/sec) the fbm domain scrolls. */
  driftSpeed: number;
  /** Master density multiplier on the final mix toward fog tint (0..1). */
  densityScale: number;
  /** fbm octaves (must equal the GLSL #define MIST_OCTAVES). */
  octaves: number;
}

export const DEFAULT_MIST_PARAMS: GroundMistParams = {
  poolY: -6,
  thinY: 2,
  nearFadeStart: 10,
  nearFadeEnd: 30,
  fbmScale: 0.15,
  driftSpeed: 0.02,
  densityScale: 0.55,
  octaves: 3,
};
