/**
 * 069 terrain surface detail: cheap value-noise fbm layered over the near
 * terrain surface to (a) mottle the LINEAR albedo and (b) perturb the
 * shading normal with the fbm gradient. Pure module: no Three.js, no
 * WebGL, no DOM — runs under jsdom. The JS hash2/vnoise/fbm mirror the
 * exported GLSL bit-for-bit so a unit test locks the algorithm; the GLSL
 * apply snippets are asserted by source-substring tests (no GPU in CI).
 * cel.ts inlines these strings behind SURFACE_DETAIL; low tier stays
 * disabled by construction (byte-identical to pre-069).
 */

import type { QualityTier } from "../core/quality";

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

export const DETAIL_NOISE_FN = /* glsl */ `
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

export const DETAIL_ALBEDO_SNIPPET = /* glsl */ `
  base *= 1.0 + uDetailStrength * (fbm(vWorldXZ * uDetailScale, DETAIL_OCTAVES) - 0.5);
`;

export const DETAIL_NORMAL_SNIPPET = /* glsl */ `
  vec2 dp = vWorldXZ * uDetailScale;
  float e = 0.5; // finite-diff step in scaled space (~0.5 world unit)
  float dnx = fbm(dp + vec2(e, 0.0), DETAIL_OCTAVES) - fbm(dp + vec2(-e, 0.0), DETAIL_OCTAVES);
  float dny = fbm(dp + vec2(0.0, e), DETAIL_OCTAVES) - fbm(dp + vec2(0.0, -e), DETAIL_OCTAVES);
  vec2 g = vec2(dnx, dny) / (2.0 * e);
  Nworld = normalize(Nworld + vec3(-g.x, 0.0, -g.y) * uDetailBump);
`;

export const DETAIL_DEFAULTS = {
  strength: 0.16,
  scale: 1.1,
  bump: 0.12,
  octaves: 3,
};

export interface TerrainDetailParams {
  enabled: boolean;
  strength: number;
  scale: number;
  bump: number;
  octaves: number;
}

export function terrainDetailForTier(tier: QualityTier): TerrainDetailParams {
  switch (tier) {
    case "low":
      return { enabled: false, strength: 0, scale: 0, bump: 0, octaves: 0 };
    case "med":
      return { enabled: true, strength: 0.12, scale: 1.1, bump: 0.08, octaves: 2 };
    case "high":
      return {
        enabled: true,
        strength: DETAIL_DEFAULTS.strength,
        scale: DETAIL_DEFAULTS.scale,
        bump: DETAIL_DEFAULTS.bump,
        octaves: DETAIL_DEFAULTS.octaves,
      };
    default: {
      const t: string = tier;
      throw new Error(`terrainDetailForTier: unknown tier: ${t}`);
    }
  }
}
