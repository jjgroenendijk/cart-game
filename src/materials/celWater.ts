import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";
import { WAVE, FOAM, GLINT_HDR_GAIN, GLINT_POWER } from "./waterShading";
import type { HeightMapField } from "./cel";

/**
 * Cel-shaded water ShaderMaterial. Vert displaces the plane by the sum of two
 * directional sines (low amplitude -> visual ripples, no collider) using the
 * shared WAVE constants. Frag is depth-aware (062): a baked bed-height sample
 * drives the shallow->deep tint, a noise-distorted smoothstep shore-foam band
 * hugs every coast, and a continuous HDR sun glint tracks the world-space sun. Consumes the
 * module-level lightUniforms (single per-frame write fans out); uSunDirWorld
 * (world-space sun) is part of that set so the glint half-vector is world-space.
 *
 * Bed height is sampled with a manual 4-tap bilinear interpolation (the shared
 * height texture stays NearestFilter for the cel terrain normal path), so the
 * foam depth contour is sub-texel smooth instead of the blocky nearest grid;
 * the foam mask is a continuous smoothstep falloff warped by a procedural
 * value-noise of world XZ into an organic coastline with patchy lathering caps.
 *
 * Output is LINEAR; ACES + sRGB land in the composer's OutputPass. fog:true +
 * the manual USE_FOG mix fade distant water into the horizon haze. With no
 * heightMap the HEIGHT_MAP define is absent -> the fragment compiles the legacy
 * facing-only look (no sampler bound), so jsdom/tests keep working.
 */

const CEL_WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  varying vec2 vWorldXZ;
  void main() {
    // World XZ before displacement: the plane follows focus (mesh.position
    // moves), so object-space xz would drift with the camera. modelMatrix
    // bakes the focus translation -> world xz is stable for depth/glint.
    vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;
    vec3 pos = position;
    float w = sin(pos.x * ${WAVE.AX} + uTime * ${WAVE.TX})
            + sin(pos.z * ${WAVE.AZ} + uTime * ${WAVE.TZ});
    pos.y += w * uAmp;
    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = mvPos.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CEL_WATER_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunDirWorld;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uBands;
  uniform vec3 uTint;
  uniform float uAmp;
  uniform float uTime;
  uniform float uWaterY;
  uniform vec3 uFoamColor;
  uniform float uFoamWidth;
  uniform float uDeepDepth;
  uniform float uGlintIntensity;
  #ifdef HEIGHT_MAP
  uniform sampler2D uHeightMap;
  uniform vec2 uHeightOrigin;
  uniform float uHeightSize;
  uniform float uHeightTexels;
  #endif
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  #endif
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  varying vec2 vWorldXZ;

  // Compact 2D hash value-noise (no asset). Deterministic; mirrors hash21 +
  // valueNoise in waterShading.ts so the foam warp/detail match CPU-for-CPU.
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(-vViewPos);
    float facing = clamp(dot(N, V), 0.0, 1.0);

    // Depth below the surface from the baked bed-height field (in-field only).
    // Out-of-field (no HEIGHT_MAP, or sample past the baked bounds) keeps the
    // legacy facing-driven look with no foam, degrading gracefully past the
    // authored region (023 streaming worlds). The bed height is a 4-tap
    // bilinear blend of the NearestFilter texture so the foam contour is
    // sub-texel smooth instead of the blocky nearest grid.
    float depth = 0.0;
    float slope = 0.0;
    bool inField = false;
    #ifdef HEIGHT_MAP
    vec2 hUV = (vWorldXZ - uHeightOrigin) / uHeightSize;
    if (all(greaterThanEqual(hUV, vec2(0.0)))
        && all(lessThanEqual(hUV, vec2(1.0)))) {
      vec2 c = hUV * uHeightTexels - 0.5;
      vec2 iBase = floor(c);
      vec2 f = c - iBase;
      float n = uHeightTexels - 1.0;
      vec2 i0c = clamp(iBase, vec2(0.0), vec2(n));
      vec2 i1c = clamp(iBase + 1.0, vec2(0.0), vec2(n));
      vec2 uv0 = (i0c + 0.5) / uHeightTexels;
      vec2 uv1 = (i1c + 0.5) / uHeightTexels;
      float h00 = texture2D(uHeightMap, vec2(uv0.x, uv0.y)).r;
      float h10 = texture2D(uHeightMap, vec2(uv1.x, uv0.y)).r;
      float h01 = texture2D(uHeightMap, vec2(uv0.x, uv1.y)).r;
      float h11 = texture2D(uHeightMap, vec2(uv1.x, uv1.y)).r;
      float bedH = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
      // Bed slope from the 4 corner heights (free: reuses the bilinear taps).
      // Foam is a shore phenomenon, so the slope gates it — flat basins read
      // blue, banks keep the lather (see the foam block below).
      float tex = uHeightSize / uHeightTexels;
      float dsdx = ((h10 - h00) + (h11 - h01)) * 0.5 / tex;
      float dsdz = ((h01 - h00) + (h11 - h10)) * 0.5 / tex;
      slope = sqrt(dsdx * dsdx + dsdz * dsdz);
      depth = uWaterY - bedH;
      inField = true;
    }
    #endif

    // Base tint: depth drives shallow->deep; facing keeps the fresnel rim job.
    vec3 base;
    if (inField) {
      float mixF = clamp(depth / uDeepDepth, 0.0, 1.0);
      base = mix(uShallow, uDeep, mixF);
    } else {
      base = mix(uDeep, uShallow, facing);
    }
    // uBands stays bound for call-site compatibility; facing is continuous.
    float band = facing;
    vec3 color = base * band;

    vec3 L = normalize(uSunDir);
    float NdL = clamp(dot(N, L), 0.0, 1.0);
    color += base * uSunColor * NdL * 0.25;
    color += base * uAmbient;

    float fres = pow(1.0 - facing, 3.0);
    color += vec3(1.0) * fres * 0.35;

    // Sun glint: analytic ripple normal vs the world-space sun half-vector.
    // Continuous HDR output mirrors glintSpecular() in waterShading.ts.
    // uGlintIntensity <= 0 skips the math (low-tier knob).
    if (uGlintIntensity > 0.0) {
      float dsdx = uAmp * ${WAVE.AX} * cos(${WAVE.AX} * vWorldXZ.x + ${WAVE.TX} * uTime);
      float dsdz = uAmp * ${WAVE.AZ} * cos(${WAVE.AZ} * vWorldXZ.y + ${WAVE.TZ} * uTime);
      vec3 Nworld = normalize(vec3(-dsdx, 1.0, -dsdz));
      vec3 worldPos = vec3(vWorldXZ.x, uWaterY, vWorldXZ.y);
      vec3 Vworld = normalize(cameraPosition - worldPos);
      vec3 H = normalize(uSunDirWorld + Vworld);
      float glint = pow(clamp(dot(Nworld, H), 0.0, 1.0), ${GLINT_POWER}.0)
        * uGlintIntensity * ${GLINT_HDR_GAIN};
      color += uSunColor * glint;
    }

    // Shore foam: a low-frequency value-noise of world XZ warps the effective
    // shore distance so the contour is a wavy organic coastline (not a straight
    // depth iso-curve); a bed-slope gate keeps it a shore phenomenon (flat
    // basins drop toward SLOPE_MIN so their blue depth-tint shows instead of
    // drowning small pools in white; banks keep the full lather); smoothstep
    // gives an anti-aliased falloff; a higher-frequency detail noise breaks the
    // band into patchy caps. The warp/detail drift slowly with uTime so the
    // foam laps. Mirrors foamMask() in waterShading.ts. Applied before uTint so
    // biome-tinted water tints its foam too.
    float foam = 0.0;
    if (inField) {
      float edge0 = ${FOAM.EDGE_INNER} * uFoamWidth;
      float edge1 = ${FOAM.EDGE_OUTER} * uFoamWidth;
      float warp = (valueNoise(vec2(
        vWorldXZ.x * ${FOAM.WARP_FREQ} + uTime * ${FOAM.WARP_DRIFT},
        vWorldXZ.y * ${FOAM.WARP_FREQ})) - 0.5)
        * 2.0 * ${FOAM.WARP_AMP} * uFoamWidth;
      float d = depth + warp;
      foam = 1.0 - smoothstep(edge0, edge1, d);
      float gate = ${FOAM.SLOPE_MIN}
        + (1.0 - ${FOAM.SLOPE_MIN})
        * smoothstep(${FOAM.SLOPE_LO}, ${FOAM.SLOPE_HI}, slope);
      foam *= gate;
      float detail = valueNoise(vec2(
        vWorldXZ.x * ${FOAM.DETAIL_FREQ} + uTime * ${FOAM.DETAIL_DRIFT},
        vWorldXZ.y * ${FOAM.DETAIL_FREQ} - uTime * ${FOAM.DETAIL_DRIFT}));
      foam *= 1.0 - ${FOAM.DETAIL_GAIN} * (1.0 - detail);
    }
    color = mix(color, uFoamColor, foam);

    color *= uTint; // biome water hue (white = identity / parity)

    #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    color = mix(color, fogColor, fogFactor);
    #endif

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface CelWaterOpts {
  /** sRGB hex for the shallow (looking-down) tint. */
  shallow?: number;
  /** sRGB hex for the deep (grazing) tint. */
  deep?: number;
  /** Retained for compatibility; facing/Fresnel shading is continuous. */
  bands?: number;
  /** Wave amplitude (metres). */
  amp?: number;
  /** sRGB hex overall hue multiplier (default white = identity). */
  tint?: number;
  /** Baked bed-height field (terrain); enables depth tint + shore foam. */
  heightMap?: HeightMapField;
  /** World Y of the water surface (depth = uWaterY - bedHeight). */
  waterY?: number;
  /** sRGB hex foam tint (applied before uTint). Default near-white. */
  foamColor?: number;
  /** Foam band width in metres (edges at 0.4 and 1.2 x this). Default 1. */
  foamWidth?: number;
  /** Depth at which the tint reaches full uDeep. Default 6. */
  deepDepth?: number;
  /** Sun glint strength (0 disables the glint math). Default 1. */
  glintIntensity?: number;
}

export class CelWaterMaterial extends THREE.ShaderMaterial {
  constructor(opts: CelWaterOpts = {}) {
    const defines: Record<string, string> = {};
    if (opts.heightMap) defines["HEIGHT_MAP"] = "";
    const uniforms: Record<string, THREE.IUniform> = {
      ...lightUniforms,
      uTime: { value: 0 },
      uAmp: { value: opts.amp ?? 0.15 },
      uShallow: { value: new THREE.Color(opts.shallow ?? 0x2a6a8a) },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x123a52) },
      uBands: { value: opts.bands ?? 2 },
      uTint: { value: new THREE.Color(opts.tint ?? 0xffffff) },
      uWaterY: { value: opts.waterY ?? -3 },
      uFoamColor: { value: new THREE.Color(opts.foamColor ?? 0xfdfdfd) },
      uFoamWidth: { value: opts.foamWidth ?? 1.0 },
      uDeepDepth: { value: opts.deepDepth ?? 6.0 },
      uGlintIntensity: { value: opts.glintIntensity ?? 1.0 },
      // fog:true makes three.js push scene-fog values here each frame; the
      // entries must exist so uniform upload can read .value.
      fogColor: { value: new THREE.Color(0xb6ad9e) },
      fogNear: { value: 90 },
      fogFar: { value: 360 },
    };
    if (opts.heightMap) {
      const hm = opts.heightMap;
      uniforms.uHeightMap = { value: hm.texture };
      uniforms.uHeightOrigin = { value: new THREE.Vector2(hm.origin[0], hm.origin[1]) };
      uniforms.uHeightSize = { value: hm.size };
      uniforms.uHeightTexels = { value: hm.texels };
    }
    super({
      defines,
      uniforms,
      vertexShader: CEL_WATER_VERT,
      fragmentShader: CEL_WATER_FRAG,
      fog: true,
    });
  }

  get uTime(): number {
    return this.uniforms.uTime.value as number;
  }

  set uTime(v: number) {
    this.uniforms.uTime.value = v;
  }

  get glintIntensity(): number {
    return this.uniforms.uGlintIntensity.value as number;
  }

  set glintIntensity(v: number) {
    this.uniforms.uGlintIntensity.value = v;
  }
}
