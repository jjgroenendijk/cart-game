const TAU = Math.PI * 2;

type Vec3 = readonly [number, number, number];

/**
 * Shared directional-wave constants. Single source of truth for the two
 * vertex sines `sin(pos.x*AX + uTime*TX) + sin(pos.z*AZ + uTime*TZ)`. The
 * celWater vertex shader mirrors these literals; commit 2 keeps them in
 * sync and tests assert the values match.
 */
export const WAVE = { AX: 0.6, TX: 1.1, AZ: 0.5, TZ: 0.9 } as const;

/**
 * Foam-edge wobble: WOBBLE_HZ is the breath rate; PHASE_PER_M advances the
 * sine phase per metre of shore depth so the band edges drift spatially,
 * not in lockstep.
 */
const WOBBLE_HZ = 0.15;
const PHASE_PER_M = 3.0;

/** Foam band edges as a fraction of foamWidth; FOAM_WOBBLE_AMP scales the edge breath. */
const FOAM_EDGE_INNER = 0.4;
const FOAM_EDGE_OUTER = 1.2;
const FOAM_WOBBLE_AMP = 0.15;

/** Glint quantization thresholds (post-intensity) and specular power. */
const GLINT_HI = 0.6;
const GLINT_LO = 0.25;
const GLINT_POWER = 64;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * GLSL smoothstep mirror: 0 for x <= e0, 1 for x >= e1, Hermite blend
 * between (e0 < e1). Mirrors the GLSL builtin the celWater foam falloff uses.
 */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Bilinear blend of four texel-corner heights. Mirrors the celWater 4-tap of
 * the NearestFilter height texture so the foam depth contour is sub-texel
 * smooth instead of the blocky nearest grid. (fx, fy) are the in-texel
 * fractions; h00 = (i0,j0), h10 = (i1,j0), h01 = (i0,j1), h11 = (i1,j1).
 */
export function bilinearHeight(
  h00: number,
  h10: number,
  h01: number,
  h11: number,
  fx: number,
  fy: number,
): number {
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fy;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

/** Positive floor depth (m): waterY minus the bed height h. */
export function depthBelow(waterY: number, h: number): number {
  return waterY - h;
}

/**
 * Continuous 0..1 shore foam (062 smooth rewrite). Full (1) at/inside the
 * inner edge, fading smoothly to 0 across the outer edge via smoothstep so
 * the band is anti-aliased instead of a pixelated cliff. A slow depth-phased
 * wobble breathes the edge over time. Mirrors the celWater foam block; the
 * shader samples the bed height with bilinearHeight for sub-texel smoothness.
 */
export function foamMask(depth: number, foamWidth: number, t: number): number {
  const edge0 = FOAM_EDGE_INNER * foamWidth;
  const edge1 = FOAM_EDGE_OUTER * foamWidth;
  const wobble = Math.sin(t * WOBBLE_HZ * TAU + depth * PHASE_PER_M) * FOAM_WOBBLE_AMP * foamWidth;
  const d = depth + wobble;
  return 1 - smoothstep(edge0, edge1, d);
}

/** 0..1 deep/shallow mix from true depth; replaces the old facing-ratio mix. */
export function depthTintMix(depth: number, deepDepth = 6): number {
  return clamp(depth / deepDepth, 0, 1);
}

/**
 * Analytic surface normal of the two vertex sines
 * `amp*(sin(AX*x + TX*t) + sin(AZ*z + TZ*t))`. Returns a unit [nx,ny,nz]
 * with ny dominant; falls back to [0,1,0] on a degenerate vector.
 */
export function rippleNormal(
  x: number,
  z: number,
  t: number,
  amp: number,
): [number, number, number] {
  const dsdx = amp * WAVE.AX * Math.cos(WAVE.AX * x + WAVE.TX * t);
  const dsdz = amp * WAVE.AZ * Math.cos(WAVE.AZ * z + WAVE.TZ * t);
  return normalize3([-dsdx, 1, -dsdz]);
}

/**
 * Quantized 2-step sun glint streak in {0, 0.5, 1}. Blinn-Phong
 * half-vector H = normalize(sunDir + viewDir); spec = pow(dot(n,H),
 * GLINT_POWER) * intensity, snapped to tiers at GLINT_HI/GLINT_LO.
 * intensity <= 0 returns 0 outright (the low-tier glint knob).
 */
export function glintBand(n: Vec3, sunDir: Vec3, viewDir: Vec3, intensity: number): number {
  if (intensity <= 0) return 0;
  const hx = sunDir[0] + viewDir[0];
  const hy = sunDir[1] + viewDir[1];
  const hz = sunDir[2] + viewDir[2];
  const len = Math.hypot(hx, hy, hz);
  if (len <= 1e-8) return 0;
  const H: Vec3 = [hx / len, hy / len, hz / len];
  const spec = Math.pow(clamp(dot3(n, H), 0, 1), GLINT_POWER) * intensity;
  if (spec >= GLINT_HI) return 1;
  if (spec >= GLINT_LO) return 0.5;
  return 0;
}
