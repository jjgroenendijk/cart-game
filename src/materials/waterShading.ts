type Vec3 = readonly [number, number, number];

/**
 * Shared directional-wave constants. Single source of truth for the two
 * vertex sines `sin(pos.x*AX + uTime*TX) + sin(pos.z*AZ + uTime*TZ)`. The
 * celWater vertex shader mirrors these literals; tests assert the values.
 */
export const WAVE = { AX: 0.6, TX: 1.1, AZ: 0.5, TZ: 0.9 } as const;

/**
 * Shore-foam tuning (062). EDGE_INNER/OUTER are the smoothstep band limits as
 * a fraction of foamWidth. WARP_* is a low-frequency value-noise of world XZ
 * added to the effective shore distance -> a wavy organic coastline instead of
 * a straight depth iso-curve. DETAIL_* is a higher-frequency noise that breaks
 * the band into patchy lathering caps. SLOPE_* gates the foam by bed slope so
 * it stays a shore phenomenon: flat basins (slope < SLOPE_LO) drop to SLOPE_MIN
 * foam so their blue depth-tint shows (fixes "small shallow pools read white"),
 * genuine banks (slope > SLOPE_HI) keep the full lather. The celWater foam
 * block interpolates these verbatim; waterShading.test pins the values.
 */
export const FOAM = {
  EDGE_INNER: 0.4,
  EDGE_OUTER: 1.2,
  WARP_FREQ: 0.18,
  WARP_DRIFT: 0.04,
  WARP_AMP: 0.45,
  DETAIL_FREQ: 0.9,
  DETAIL_DRIFT: 0.15,
  DETAIL_GAIN: 0.55,
  SLOPE_LO: 0.12,
  SLOPE_HI: 0.22,
  SLOPE_MIN: 0.15,
} as const;

/** Glint quantization thresholds (post-intensity) and specular power. */
const GLINT_HI = 0.6;
const GLINT_LO = 0.25;
const GLINT_POWER = 64;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function mix1(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compact 2D hash -> [0,1]. Mirrors the GLSL `hash21` in celWater exactly so
 * the foam noise is bit-identical on CPU and GPU: fract each axis, add the
 * dot product, fract the product. (x, y) is the integer lattice point.
 */
function hash21(x: number, y: number): number {
  let a = fract(x * 123.34);
  let b = fract(y * 345.45);
  const d = a * (a + 34.345) + b * (b + 34.345);
  a += d;
  b += d;
  return fract(a * b);
}

/**
 * Smooth value-noise in [0,1]: bilinear blend of four lattice hashes with a
 * smoothstep (C1) fall-off so the field is continuous. Mirrors the GLSL
 * `valueNoise` in celWater (same hash + same smoothstep blend) for parity.
 */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const dd = hash21(ix + 1, iy + 1);
  return mix1(mix1(a, b, ux), mix1(c, dd, ux), uy);
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
 * Continuous 0..1 shore foam (062). A low-frequency value-noise of world XZ
 * warps the effective shore distance so the contour is a wavy organic
 * coastline (not a straight depth iso-curve); smoothstep gives an
 * anti-aliased falloff across [EDGE_INNER, EDGE_OUTER]*width; a bed-slope gate
 * keeps foam a shore phenomenon (flat basins drop to SLOPE_MIN so their blue
 * depth-tint shows, banks keep the full lather); a higher-frequency detail
 * noise breaks the band into patchy caps. The warp/detail drift slowly with t
 * so the foam laps. Mirrors the celWater foam block; the shader samples the bed
 * height with bilinearHeight for sub-texel smoothness and derives `slope` from
 * the same 4 corner taps (free, no extra texture reads).
 */
export function foamMask(
  x: number,
  z: number,
  depth: number,
  slope: number,
  foamWidth: number,
  t: number,
): number {
  const edge0 = FOAM.EDGE_INNER * foamWidth;
  const edge1 = FOAM.EDGE_OUTER * foamWidth;
  const warp =
    (valueNoise(x * FOAM.WARP_FREQ + t * FOAM.WARP_DRIFT, z * FOAM.WARP_FREQ) - 0.5) *
    2 *
    FOAM.WARP_AMP *
    foamWidth;
  const d = depth + warp;
  let foam = 1 - smoothstep(edge0, edge1, d);
  const gate =
    FOAM.SLOPE_MIN + (1 - FOAM.SLOPE_MIN) * smoothstep(FOAM.SLOPE_LO, FOAM.SLOPE_HI, slope);
  foam *= gate;
  const detail = valueNoise(
    x * FOAM.DETAIL_FREQ + t * FOAM.DETAIL_DRIFT,
    z * FOAM.DETAIL_FREQ - t * FOAM.DETAIL_DRIFT,
  );
  foam *= 1 - FOAM.DETAIL_GAIN * (1 - detail);
  return clamp(foam, 0, 1);
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
