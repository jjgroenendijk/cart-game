/**
 * CelMaterial shader sources: the vertex program (CEL_VERT) and the fragment
 * builder (celFragmentShader) that concatenates the optional WETNESS /
 * SNOW_COVER / SURFACE_DETAIL / AERIAL / fade blocks behind their defines. Split
 * out of cel.ts so that file stays under the 600-line cap once both snow cover
 * and aerial perspective landed. All snippets are pure strings (jsdom-safe);
 * off-path concatenation is byte-identical to the pre-feature source (the repo
 * shader invariant). See ./cel.ts for the CelMaterial class + uniform wiring.
 */

import { AERIAL_GLSL, AERIAL_UNIFORM_GLSL } from "./aerial";
import {
  FADE_DISCARD_GLSL,
  FADE_DISCARD_INV_GLSL,
  FADE_GLSL,
  FADE_HAZE_GLSL,
  FADE_UNIFORM_GLSL,
} from "./fade";
import { DETAIL_ALBEDO_SNIPPET, DETAIL_NOISE_FN, DETAIL_NORMAL_SNIPPET } from "./terrainDetail";
import { SNOW_APPLY, SNOW_HEADER } from "./snowCover";

export const CEL_VERT = /* glsl */ `
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  #ifdef VERTEX_COLORS
  // The color attribute is injected by three.js (USE_COLOR) when vertexColors
  // is on; we only add the varying here.
  varying vec3 vColor;
  #endif
  #if defined(HEIGHT_MAP) || defined(SNOW_COVER)
  varying vec2 vWorldXZ;
  #endif
  #ifdef SNOW_COVER
  varying vec3 vWorldNormal;
  #endif
  #ifdef GEOMORPH
  attribute float aMorphTarget;
  uniform float uMorph;
  #endif
  #include <shadowmap_pars_vertex>
  void main() {
    // three.js declares instanceMatrix (USE_INSTANCING) for InstancedMesh but
    // only applies it inside shader chunks we don't include, so apply it here:
    // position + normal are transformed into instance space first. Uniform-scale
    // decor (bushes/flowers/grass/clouds) is the intended use; non-instanced
    // meshes leave USE_INSTANCING undefined -> identical to the plain path.
    vec3 transformed = position;
    vec3 transformedNormal = normal;
    #ifdef GEOMORPH
    transformed.y = mix(position.y, aMorphTarget, uMorph); // 199 LOD geomorph
    #endif
    #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(position, 1.0)).xyz;
    transformedNormal = mat3(instanceMatrix) * normal;
    #endif
    vec4 mvPos = modelViewMatrix * vec4(transformed, 1.0);
    vViewPos = mvPos.xyz;
    vViewNormal = normalize(normalMatrix * transformedNormal);
    #ifdef VERTEX_COLORS
    vColor = color;
    #endif
    gl_Position = projectionMatrix * mvPos;
    // World position is shared by the heightmap per-pixel normal path (needs
    // world x,z) and the shadow coord path. transformed already carries
    // instanceMatrix, so build worldPosition with modelMatrix only (NOT the
    // shadowmap_vertex chunk, which would double-apply instanceMatrix).
    #if defined(HEIGHT_MAP) || defined(SNOW_COVER) || NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    #endif
    #if defined(HEIGHT_MAP) || defined(SNOW_COVER)
    vWorldXZ = worldPosition.xz;
    #endif
    #ifdef SNOW_COVER
    // World-space surface normal for the snow up-facing + windward terms (far
    // terrain + props have no heightmap; near terrain uses Nworld.y instead).
    // transformed already carries instanceMatrix; modelMatrix adds the mesh xf.
    vWorldNormal = mat3(modelMatrix) * transformedNormal;
    #endif
    #if NUM_DIR_LIGHT_SHADOWS > 0
    #pragma unroll_loop_start
    for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
      vDirectionalShadowCoord[i] = directionalShadowMatrix[i] * worldPosition;
    }
    #pragma unroll_loop_end
    #endif
  }
`;

// Bilinear height tap (HEIGHT_SMOOTH on): mix 4 NearestFilter samples by the
// texel-fractional offset -> the reconstructed normal is C0 instead of
// piecewise-constant per texel, so cel shades vary smoothly and the
// ~texel-size square shade grid disappears. NearestFilter kept (float-linear
// is not core in WebGL2); this manual bilinear is the device-safe equivalent.
// Texel centre i sits at hp = i+0.5 (world->texel space), so the bilinear
// knots must align there: shift by -0.5 before floor/fract, else the
// reconstructed field - and its normal - are half a texel out of phase with
// the mesh geometry and cel/lambert shades stop tracking the landscape.
const HEIGHT_SMOOTH_FN = `
  #ifdef HEIGHT_SMOOTH
  float sampleH(vec2 worldXZ) {
    vec2 hp = (worldXZ - uHeightOrigin) / uHeightTexelWorld;
    float texelUV = uHeightTexelWorld / uHeightSize;
    vec2 c = hp - 0.5;
    vec2 base = (floor(c) + 0.5) * texelUV;
    vec2 f = fract(c);
    float h00 = texture2D(uHeightMap, base).r;
    float h10 = texture2D(uHeightMap, base + vec2(texelUV, 0.0)).r;
    float h01 = texture2D(uHeightMap, base + vec2(0.0, texelUV)).r;
    float h11 = texture2D(uHeightMap, base + vec2(texelUV, texelUV)).r;
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
  #endif
`;

// HEIGHT_SMOOTH-on opening: central-difference neighbours read via the
// bilinear helper. Falls through to the nearest 4-tap path in #else.
const HEIGHT_TAPS_SMOOTH = `
    #ifdef HEIGHT_SMOOTH
    float hL = sampleH(vWorldXZ + vec2(-uHeightTexelWorld, 0.0));
    float hR = sampleH(vWorldXZ + vec2(uHeightTexelWorld, 0.0));
    float hD = sampleH(vWorldXZ + vec2(0.0, -uHeightTexelWorld));
    float hU = sampleH(vWorldXZ + vec2(0.0, uHeightTexelWorld));
    #else
`;

// Nearest 4-tap path (the original #26 central-difference taps). Shared by
// both branches: the HEIGHT_SMOOTH #else, and the whole block when the opt
// is off (bit-identical fallback -> no raw `sampleH`/`#ifdef HEIGHT_SMOOTH`
// in the off-path source).
const HEIGHT_TAPS_NEAREST = `
    vec2 hUV = (vWorldXZ - uHeightOrigin) / uHeightSize;
    float hOff = uHeightTexelWorld / uHeightSize; // 1 texel in uv units
    float hL = texture2D(uHeightMap, hUV + vec2(-hOff, 0.0)).r;
    float hR = texture2D(uHeightMap, hUV + vec2(hOff, 0.0)).r;
    float hD = texture2D(uHeightMap, hUV + vec2(0.0, -hOff)).r;
    float hU = texture2D(uHeightMap, hUV + vec2(0.0, hOff)).r;
`;

const HEIGHT_TAPS_END = `
    #endif
`;

// SURFACE_DETAIL header pieces (069). The shared value-noise fns (hash2/vnoise/
// fbm) are declared ONCE at top-level (see noiseFns below) whenever detail OR
// snow needs them; this header only carries the uDetail* uniforms + the
// DETAIL_OCTAVES compile constant. Off-path stays byte-identical (never
// referenced when both surfaceDetail + snowCover are off).
const DETAIL_HEADER_PREFIX = `
#ifdef SURFACE_DETAIL
    uniform float uDetailStrength;
    uniform float uDetailScale;
    uniform float uDetailBump;
    #define DETAIL_OCTAVES `;
const DETAIL_HEADER_SUFFIX = `
#endif`;

export function celFragmentShader(
  heightSmooth: boolean,
  wetness: boolean,
  surfaceDetail: boolean,
  detailOctaves: number,
  fade: boolean,
  snowCover: boolean,
  fadeInvert: boolean,
  fadeHaze: boolean,
): string {
  const smoothFn = heightSmooth ? HEIGHT_SMOOTH_FN : "";
  const taps = heightSmooth
    ? `${HEIGHT_TAPS_SMOOTH}${HEIGHT_TAPS_NEAREST}${HEIGHT_TAPS_END}`
    : HEIGHT_TAPS_NEAREST;
  // SURFACE_DETAIL injection: each helper is "" when off + concatenated with NO
  // whitespace => off-path byte-identical to pre-069. detailHeader keeps only
  // the uDetail* uniforms + DETAIL_OCTAVES; the shared value-noise fns go in
  // noiseFns (ONE top-level fbm shared by detail + snow, no double def).
  const detailHeader = surfaceDetail
    ? DETAIL_HEADER_PREFIX + detailOctaves + DETAIL_HEADER_SUFFIX
    : "";
  // Shared value-noise fns: declared once at top-level when detail OR snow needs
  // fbm. Snow header + apply block are "" when off (byte-identical fallback).
  const noiseFns = surfaceDetail || snowCover ? DETAIL_NOISE_FN : "";
  const snowHeader = snowCover ? SNOW_HEADER : "";
  const snowApply = snowCover ? SNOW_APPLY : "";
  // Perturb the world-space heightmap normal with the fbm gradient before the
  // view-space map (Nworld -> normalMatrix -> N).
  const detailNormal = surfaceDetail
    ? `\n    #ifdef SURFACE_DETAIL${DETAIL_NORMAL_SNIPPET}    #endif`
    : "";
  // Mottle the LINEAR base before the wetness term so the ACES+sRGB-once
  // invariant holds; the trailing "\n    " hands indentation back to the
  // wetness line on the same template line.
  const detailAlbedo = surfaceDetail
    ? `#ifdef SURFACE_DETAIL${DETAIL_ALBEDO_SNIPPET}#endif\n    `
    : "";
  // Wetness multiply on the LINEAR base (054). Extracted to a const so the
  // template line stays under the 100-char cap; off = "" (byte-identical).
  const wetnessMul = wetness
    ? "#ifdef WETNESS\n    base *= (1.0 - 0.25 * uWetness);\n    #endif"
    : "";
  // Dither fade (concat pattern, mirrors wetness): the uniform + helper fns
  // join the header, the discard opens main() so a dissolved fragment skips
  // all shading work. fadeHaze needs only the uFade uniform (no discard fn), and
  // reveals via a fog-colour lerp in the USE_FOG block instead. Off = "" ->
  // byte-identical fragment.
  const needsFadeFn = fade || fadeInvert;
  const needsFadeUniform = needsFadeFn || fadeHaze;
  const fadeHeader = needsFadeUniform
    ? `\n  ${FADE_UNIFORM_GLSL}${needsFadeFn ? FADE_GLSL : ""}`
    : "";
  const fadeDiscard = fade
    ? `\n    ${FADE_DISCARD_GLSL}`
    : fadeInvert
      ? `\n    ${FADE_DISCARD_INV_GLSL}`
      : "";
  // Haze-in reveal: spliced inside USE_FOG AFTER the fog mix so a streamed prop
  // materialises out of the atmosphere instead of stippling. "" when off.
  const hazeReveal = fadeHaze ? `\n    ${FADE_HAZE_GLSL}` : "";
  return /* glsl */ `
  uniform vec3 uSunDir;     // view space, normalized
  uniform vec3 uSunColor;   // linear
  uniform vec3 uAmbient;    // linear
  uniform float uShadowFade;   // day-cycle cast-shadow fade (default 1)
  uniform vec3 uColor;      // linear base color
  uniform float uBands;
  uniform float uBandEdge;
  uniform vec3 uRimColor;
  uniform float uRimPower;
  uniform float uRimIntensity;
  #ifdef SPECULAR
  uniform float uSpecularShininess;
  uniform float uSpecularIntensity;
  #endif
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;${AERIAL_UNIFORM_GLSL}
  #endif
  ${wetness ? "#ifdef WETNESS\n  uniform float uWetness;\n  #endif" : ""}${fadeHeader}

  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  #ifdef VERTEX_COLORS
  varying vec3 vColor;
  #endif
  #ifdef HEIGHT_MAP
  uniform sampler2D uHeightMap;
  uniform vec2 uHeightOrigin;
  uniform float uHeightSize;
  uniform float uHeightTexelWorld; // world units per heightmap texel
  // three.js injects normalMatrix via the VERTEX shader prefix only; the
  // fragment prefix omits it, so declare it here to map the world-space
  // heightmap normal into view space. Links to the same uniform the vertex
  // already declares (single per-program upload); no redefinition because
  // the fragment prefix never adds it.
  uniform mat3 normalMatrix;
  varying vec2 vWorldXZ;
  ${smoothFn}${detailHeader}
  #endif
  ${snowHeader}${noiseFns}
  #include <common>
  #include <shadowmap_pars_fragment>

  void main() {${fadeDiscard}
    vec3 N;
    #ifdef HEIGHT_MAP
    // Per-pixel surface normal from the heightmap (triangulation-independent):
    // central-difference four texel neighbours at the fragment's world (x,z).
    // Because N no longer folds across each quad diagonal, cel-quantizing
    // dot(N,L) can't form the diagonal/diamond band pattern the per-vertex
    // interpolated normal produced. world-space N -> view via normalMatrix.
    ${taps}
    float dhx = (hR - hL) / (2.0 * uHeightTexelWorld);
    float dhz = (hU - hD) / (2.0 * uHeightTexelWorld);
    vec3 Nworld = normalize(vec3(-dhx, 1.0, -dhz));${detailNormal}
    N = normalize(normalMatrix * Nworld);
    #elif defined(FLAT)
      vec3 dpdx = dFdx(vViewPos);
      vec3 dpdy = dFdy(vViewPos);
      N = normalize(cross(dpdx, dpdy));
    #else
      N = normalize(vViewNormal);
    #endif

    vec3 L = normalize(uSunDir);
    float NdL = clamp(dot(N, L), 0.0, 1.0);

    // Diffuse term: smooth lambert (SMOOTH_DIFFUSE; terrain) or cel banding
    // (default; karts/props). On a smooth height normal the cel contour lines
    // read as stripes across the landscape, so terrain shades smoothly. The
    // cel path snaps lambert into uBands steps with a narrow AA edge; clamp
    // guarantees a lit floor (1/uBands).
    float band;
    #ifdef SMOOTH_DIFFUSE
    band = NdL;
    #else
    float scaled = NdL * uBands;
    float bandIdx = floor(scaled);
    float f = scaled - bandIdx;
    float bandLow = bandIdx / uBands;
    float bandHigh = (bandIdx + 1.0) / uBands;
    float w = smoothstep(1.0 - uBandEdge, 1.0, f);
    band = mix(bandLow, bandHigh, w);
    band = clamp(band, 1.0 / uBands, 1.0);
    #endif

    // Per-vertex color modulates the linear base (terrain road/grass/rock).
    vec3 base = uColor;
    #ifdef VERTEX_COLORS
    base *= vColor;
    #endif
    ${detailAlbedo}${wetnessMul}${snowApply}

    vec3 diffuse = base * uSunColor * band;
    // Real shadow map (LINEAR mask): multiply the sun term only so shadowed
    // fragments fall back to ambient. Inline the single directional light
    // (the sun) so we depend only on shadowmap_pars_fragment (getShadow +
    // DirectionalLightShadow struct). Guarded so it compiles out when no
    // shadow-casting light is active (sun below threshold -> Renderer clears
    // sun.castShadow -> USE_SHADOWMAP/NUM_DIR_LIGHT_SHADOWS undefined).
    #ifdef USE_SHADOWMAP
    #if NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dirShadow = directionalLightShadows[0];
    diffuse *= getShadow(
      directionalShadowMap[0],
      dirShadow.shadowMapSize,
      dirShadow.shadowIntensity,
      dirShadow.shadowBias,
      dirShadow.shadowRadius,
      vDirectionalShadowCoord[0]
    ) * uShadowFade;
    #endif
    #endif
    vec3 color = diffuse + base * uAmbient;

    // Rim: brightest where the surface turns away from the camera.
    vec3 V = normalize(-vViewPos);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower) * uRimIntensity;
    color += uRimColor * rim;

    #ifdef SPECULAR
      vec3 H = normalize(L + V);
      float spec = pow(clamp(dot(N, H), 0.0, 1.0), uSpecularShininess);
      spec = step(0.5, spec) * uSpecularIntensity;
      color += vec3(spec);
    #endif

    // Linear distance fog toward the scene fog colour (view-space depth). Hazes
    // distant world geometry into the horizon so the streamed-terrain edge
    // dissolves rather than ending in a hard cutoff. Compiled out without
    // USE_FOG (fog:false or an unfogged scene) -> byte-identical fallback.
    #ifdef USE_FOG
    // Aerial perspective (./aerial.ts) grades distant fragments cold BEFORE the
    // haze mix; compiles out without AERIAL.${AERIAL_GLSL}
    float fogFactor = smoothstep(fogNear, fogFar, -vViewPos.z);
    color = mix(color, fogColor, fogFactor);${hazeReveal}
    #endif

    gl_FragColor = vec4(color, 1.0);
  }
  `;
}
