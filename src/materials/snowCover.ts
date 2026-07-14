/**
 * Snow-cover GLSL + uniform wiring for the cel terrain/prop material (behind the
 * SNOW_COVER define). Kept out of cel.ts so that file stays under the 600-line
 * cap, in the same split pattern as ./fade.ts and ./terrainDetail.ts. GLSL is
 * pure strings; the only Three.js used is Color/Vector2 in the uniform factory
 * (no WebGL, jsdom-safe). cel.ts inlines the strings and shares the value-noise
 * fns (hash2/vnoise/fbm) from ./terrainDetail with the surface-detail path so
 * fbm is declared exactly once.
 *
 * Snow settles on upward-facing, flatter surfaces in fbm patches. The up-facing
 * term is the per-pixel heightmap normal `Nworld.y` on near terrain, or the
 * interpolated world normal `vWorldNormal.y` on far terrain + flat-shaded props.
 * On top of the base whitening the painterly realism layers are:
 *   - blue shadows: snow albedo cools toward `uSnowShadowColor` in shade (keyed
 *     on the lambert `band` already computed), the biggest cold-read payoff and
 *     pure albedo (no specular gloss);
 *   - sparkle: sparse hash glints on lit snow, gated by sun + view so they read
 *     as glitter (tier-gated off on low via the SNOW_SPARKLE define);
 *   - wind drift: coverage biased toward windward-facing normals (`uSnowWindDir`)
 *     so snow piles thicker on windward slopes, thinner on the lee.
 * A one-sided `smoothstep(patch, patch+w, cover)` keeps the mask STRICTLY 0 at
 * cover 0, and the whole block sits behind `if (uSnowCover > 0.0)` so it is
 * near-free while the shared channel is 0.
 */

import * as THREE from "three";

/** Per-material snow defaults (fixed tuning; the cover level is the shared
 *  {@link snowUniform} channel, wind dir is shared too). */
export const SNOW_DEFAULTS = {
  /** Linear-from-sRGB snow albedo (cool white). */
  color: 0xdfe6f0,
  /** Cool periwinkle the shadowed snow tints toward (blue-shadow realism). */
  shadowColor: 0x9db4d8,
  /** How far shaded snow pushes toward shadowColor (0..1). */
  shadowStrength: 0.55,
  /** Up-facing threshold: normal.y above this snows over (flat ground fully;
   *  tree crowns partially; steep cliffs/trunks bare). */
  slope: 0.5,
  /** World-space fbm frequency (~16 m patches). */
  patchScale: 0.06,
  /** Sparkle glint strength added to lit snow (0 disables). */
  sparkle: 0.6,
  /** Windward-accumulation bias: extra coverage where the surface faces the
   *  wind. 0 = uniform; ~0.35 = noticeably thicker windward. */
  windBias: 0.35,
};

/**
 * Top-level header: snow uniforms + the varyings the HEIGHT_MAP block does not
 * already provide (vWorldXZ only when there is no heightmap; vWorldNormal
 * always). Placed outside the HEIGHT_MAP block so props + far terrain see them.
 * SNOW_SPARKLE is a separate define so low tier compiles the glint out entirely.
 */
export const SNOW_HEADER = `
#ifdef SNOW_COVER
  uniform float uSnowCover;
  uniform vec2 uSnowWindDir;
  uniform vec3 uSnowColor;
  uniform vec3 uSnowShadowColor;
  uniform float uSnowShadowStrength;
  uniform float uSnowSlope;
  uniform float uSnowPatchScale;
  uniform float uSnowWindBias;
  #ifdef SNOW_SPARKLE
  uniform float uSnowSparkle;
  #endif
  #define SNOW_OCTAVES 4
  #ifndef HEIGHT_MAP
  varying vec2 vWorldXZ;
  #endif
  varying vec3 vWorldNormal;
#endif`;

/** In-main apply: whiten the LINEAR base by the patchy, slope-gated, wind-biased
 *  snow mask, then cool the covered snow in shade and add lit sparkle. Runs
 *  after `base`, the lambert `band`, view `V`, and `N` are established. */
export const SNOW_APPLY = `
    #ifdef SNOW_COVER
    if (uSnowCover > 0.0) {
      #ifdef HEIGHT_MAP
      vec3 snowN = Nworld;
      #else
      vec3 snowN = normalize(vWorldNormal);
      #endif
      float snowUp = snowN.y;
      float snowSlope = smoothstep(uSnowSlope - 0.25, uSnowSlope + 0.1, snowUp);
      // Windward faces gather more: bias the effective cover by the horizontal
      // normal's alignment with the wind. Stays 0 at uSnowCover 0 (no leak).
      float windward = dot(normalize(snowN.xz + vec2(1e-5)), uSnowWindDir);
      float snowCov = clamp(uSnowCover * (1.0 + uSnowWindBias * windward), 0.0, 1.0);
      float snowPatch = fbm(vWorldXZ * uSnowPatchScale, SNOW_OCTAVES);
      float snowMask = snowSlope * smoothstep(snowPatch, snowPatch + 0.16, snowCov);
      // Cool the snow in shade toward the blue shadow tint (band is the lambert
      // term); brights stay near white -> painterly cold reading.
      vec3 snowAlbedo = mix(uSnowColor, uSnowShadowColor, (1.0 - band) * uSnowShadowStrength);
      #ifdef SNOW_SPARKLE
      // Sparse glints on lit, camera-facing snow. Static hash points read as
      // glitter and shift as the view moves; kept subtle + off on low tier. The
      // view vector V is computed later (rim term), so derive it locally here.
      float glint = step(0.97, hash2(vWorldXZ * 260.0));
      float facing = clamp(dot(N, normalize(-vViewPos)), 0.0, 1.0);
      snowAlbedo += uSnowSparkle * glint * band * facing;
      #endif
      base = mix(base, snowAlbedo, clamp(snowMask, 0.0, 1.0));
    }
    #endif`;

/**
 * Shared snow-cover channel: cover level (0..1) + a world-space wind direction
 * (default +X, matching Weather's DEFAULT_WIND). Terrain + prop CelMaterials
 * bind these BY REFERENCE, so one Environment write per frame fans out to every
 * chunk + prop. Default cover 0 = no effect (fragment byte-identical to the
 * pre-snow path). Wind dir is shared so a future wind system can rotate
 * accumulation without touching every material.
 */
export const snowUniform = {
  uSnowCover: { value: 0 },
  uSnowWindDir: { value: new THREE.Vector2(1, 0) },
};

/**
 * Per-material snow uniform set: the shared cover/wind-dir refs (above) plus the
 * fixed SNOW_DEFAULTS tuning. uSnowSparkle is included only when the glint is
 * compiled in (SNOW_SPARKLE define); low tier passes useSparkle false.
 */
export function snowUniforms(useSparkle: boolean): Record<string, THREE.IUniform> {
  const u: Record<string, THREE.IUniform> = {
    uSnowCover: snowUniform.uSnowCover,
    uSnowWindDir: snowUniform.uSnowWindDir,
    uSnowColor: { value: new THREE.Color(SNOW_DEFAULTS.color) },
    uSnowShadowColor: { value: new THREE.Color(SNOW_DEFAULTS.shadowColor) },
    uSnowShadowStrength: { value: SNOW_DEFAULTS.shadowStrength },
    uSnowSlope: { value: SNOW_DEFAULTS.slope },
    uSnowPatchScale: { value: SNOW_DEFAULTS.patchScale },
    uSnowWindBias: { value: SNOW_DEFAULTS.windBias },
  };
  if (useSparkle) u.uSnowSparkle = { value: SNOW_DEFAULTS.sparkle };
  return u;
}
