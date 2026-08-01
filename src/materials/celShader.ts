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
  #if defined(SNOW_COVER) || defined(SKY_ENV) || defined(ENV_REFLECT)
  varying vec3 vWorldNormal;
  #endif
  #ifdef ENV_REFLECT
  // 243 world-space fragment position for the reflection view vector
  // (cameraPosition - vWorldPos); kart body env-reflection only.
  varying vec3 vWorldPos;
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
    #if defined(HEIGHT_MAP) || defined(SNOW_COVER) || \
        defined(ENV_REFLECT) || NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    #endif
    #if defined(HEIGHT_MAP) || defined(SNOW_COVER)
    vWorldXZ = worldPosition.xz;
    #endif
    #if defined(SNOW_COVER) || defined(SKY_ENV) || defined(ENV_REFLECT)
    // World-space surface normal for the snow up-facing + windward terms (far
    // terrain + props have no heightmap; near terrain uses Nworld.y instead).
    // transformed already carries instanceMatrix; modelMatrix adds the mesh xf.
    // 283: also feeds the SKY_ENV ambient cube sample; guard widened so the
    // varying exists when either define is set.
    // 243: also feeds the ENV_REFLECT reflection vector; guard widened again.
    vWorldNormal = mat3(modelMatrix) * transformedNormal;
    #endif
    #ifdef ENV_REFLECT
    vWorldPos = worldPosition.xyz;
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
  tempGrade: boolean,
  skyEnv: boolean,
  envReflect: boolean,
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
  // TEMP_GRADE (237): warm-sun/cool-shade temperature split. Lit faces lean warm
  // (toward uSunColor), unlit lean cool (toward uShadeTint); strength ramps with
  // uTempContrast (0 at noon -> ~0.25 golden hours). Off = "" (byte-identical).
  const tempUniforms = tempGrade
    ? "\n  uniform vec3 uShadeTint;\n  uniform float uTempContrast;"
    : "";
  const tempGradeBlock = tempGrade
    ? `
#ifdef TEMP_GRADE
    {
      float lit = band;
      #ifdef USE_SHADOWMAP
      #if NUM_DIR_LIGHT_SHADOWS > 0
      lit *= celShadowMask * uShadowFade;
      #endif
      #endif
      // Lit -> warm (toward uSunColor), unlit -> cool (toward uShadeTint).
      // Each tint normalized to its max channel + centred at 1.0 (luminance-
      // neutral); amplitude scaled by uTempContrast. Multiply-only: never
      // subtracts to zero; at uTempContrast==0 the weight is exactly 1 -> identity.
      float warmMax = max(max(uSunColor.r, uSunColor.g), uSunColor.b) + 1e-5;
      vec3 warmW = 1.0 + (uSunColor / warmMax - vec3(0.3333)) * uTempContrast;
      float coolMax = max(max(uShadeTint.r, uShadeTint.g), uShadeTint.b) + 1e-5;
      vec3 coolW = 1.0 + (uShadeTint / coolMax - vec3(0.3333)) * uTempContrast;
      color *= mix(coolW, warmW, lit);
    }
#endif`
    : "";
  // 283 SKY_ENV: sample the runtime-captured sky cubemap (uSkyEnv, shared via
  // lightUniforms) with the world normal for a directional ambient (zenith blue
  // above, warm horizon grazing), blended toward the flat day-cycle ambient by
  // uSkyEnvStrength. Each helper is "" when off -> off-path byte-identical.
  const skyEnvUniforms = skyEnv
    ? "\n  uniform samplerCube uSkyEnv;\n  uniform float uSkyEnvStrength;"
    : "";
  // vWorldNormal is declared in SNOW_HEADER under SNOW_COVER; when only SKY_ENV
  // is set (snowCover off) the fragment still needs the varying. Declare it here
  // guarded so it never doubles up when both defines are present.
  const skyEnvVarying = skyEnv
    ? "\n  #if defined(SKY_ENV) && !defined(SNOW_COVER)\n  varying vec3 vWorldNormal;\n  #endif"
    : "";
  const colorInit = skyEnv
    ? `vec3 ambientTerm;
#ifdef SKY_ENV
    {
      vec3 skyAmb = textureCube(uSkyEnv, normalize(vWorldNormal)).rgb;
      ambientTerm = mix(uAmbient, skyAmb, clamp(uSkyEnvStrength, 0.0, 1.0));
    }
#else
    ambientTerm = uAmbient;
#endif
    vec3 color = diffuse + base * ambientTerm;`
    : `vec3 color = diffuse + base * uAmbient;`;
  // 243 ENV_REFLECT: fresnel-weighted, roughness-blurred sky-cube reflection +
  // a ground-bounce tint for downward rays so kart bodywork reads as painted
  // metal that picks up its sky/ground rather than uniform paint or chrome.
  // Each helper is "" when off -> off-path fragment byte-identical. uSkyEnv is
  // shared with SKY_ENV (declared by skyEnvUniforms); guarded here so the two
  // never double-declare when both defines are set on one material. uGroundTint
  // + uSkyEnvMipCount are shared via lightUniforms (spread by-ref in cel.ts).
  const envReflectUniforms = envReflect
    ? "\n  #if defined(ENV_REFLECT) && !defined(SKY_ENV)\n" +
      "  uniform samplerCube uSkyEnv;\n  #endif\n" +
      "  uniform float uSkyEnvMipCount;\n  uniform vec3 uGroundTint;\n" +
      "  uniform float uEnvStrength;\n  uniform float uEnvRoughness;"
    : "";
  const envReflectVarying = envReflect
    ? "\n  #if defined(ENV_REFLECT) && !defined(SKY_ENV) && !defined(SNOW_COVER)\n" +
      "  varying vec3 vWorldNormal;\n  #endif\n" +
      "  #if defined(ENV_REFLECT)\n  varying vec3 vWorldPos;\n  #endif"
    : "";
  // cameraPosition is declared by three's fragment prefix unconditionally, so
  // the world-space view vector needs no extra uniform. LOD mirrors the pure
  // roughnessToMipLevel() helper (SkyCapture.ts): floor(rough*(mips-1)+0.5).
  // textureCubeLodEXT maps to native textureLod in three's WebGL2 prefix, so a
  // controlled roughness mip is sampled without EXT_shader_texture_lod.
  const envReflectBlock = envReflect
    ? `
    #ifdef ENV_REFLECT
    {
      vec3 Nworld = normalize(vWorldNormal);
      vec3 Vworld = normalize(cameraPosition - vWorldPos);
      float NdotV = clamp(dot(Nworld, Vworld), 0.0, 1.0);
      // Tier gate: rides the #283 skyEnvSize gate via uSkyEnvMipCount (0 when the
      // sky capture is off), so low tier is identity WITHOUT a per-kart material
      // rebuild and a runtime tier flip takes effect the next frame. The branch
      // also keeps the null uSkyEnv from being sampled on low tier.
      if (uSkyEnvMipCount > 0.0) {
        vec3 R = reflect(-Vworld, Nworld);
        // Fresnel peaks at grazing angles so face-on panels keep their saturated
        // livery colour (gameplay read); env contribution never dominates (~30%).
        float fres = pow(1.0 - NdotV, 3.0);
        // Downward rays have no sky to mirror -> fall back to the biome ground
        // tint (grass/road average) so undersides sit in their environment.
        // LOD mirrors roughnessToMipLevel(): floor(r*(mips-1)+0.5).
        float envMip = floor(
          clamp(uEnvRoughness, 0.0, 1.0) * max(uSkyEnvMipCount - 1.0, 0.0) + 0.5);
        vec3 envCol = R.y < 0.0
          ? uGroundTint
          : textureCubeLodEXT(uSkyEnv, R, envMip).rgb;
        color += envCol * fres * clamp(uEnvStrength, 0.0, 1.0);
      }
    }
    #endif`
    : "";
  return /* glsl */ `
  uniform vec3 uSunDir;     // view space, normalized
  uniform vec3 uSunColor;   // linear
  uniform vec3 uAmbient;    // linear${tempUniforms}${skyEnvUniforms}${envReflectUniforms}
  uniform float uShadowFade;   // day-cycle cast-shadow fade (default 1)
  uniform vec2 uCascadeSplit;   // 144 near->far blend: x=split, y=blendWidth
  uniform vec3 uColor;      // linear base color
  uniform float uBands;
  uniform float uBandEdge;
  uniform vec3 uRimColor;
  uniform float uRimPower;
  uniform float uRimIntensity;
  #ifdef SPECULAR
  uniform float uRoughness;
  uniform float uSpecularIntensity;
  #endif
  #ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;${AERIAL_UNIFORM_GLSL}
  #endif
  ${wetness ? "#ifdef WETNESS\n  uniform float uWetness;\n  #endif" : ""}${fadeHeader}

  varying vec3 vViewPos;
  varying vec3 vViewNormal;${skyEnvVarying}${envReflectVarying}
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

    // Diffuse term: smooth lambert (DEFAULT; SMOOTH_DIFFUSE) or cel banding
    // (opt-in legacy path via banded:true; karts/props). On a smooth height
    // normal the cel contour lines read as stripes across the landscape, so
    // terrain shades smoothly. The cel path snaps lambert into uBands steps
    // with a narrow AA edge; clamp guarantees a lit floor (1/uBands).
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
    // 144 cascade shadows. Near cascade (sharp contact range) is always [0]; on
    // low tier (NUM_DIR_LIGHT_SHADOWS==1) it is the only cascade and this path
    // is byte-identical to the pre-144 single-box shadow. Med/high add a far
    // cascade [1] (soft middle-distance) blended by view distance. Shadow mask
    // multiplies the sun term only; the ambient term added below is untouched so
    // a fully-shadowed fragment falls to the ambient floor, never black.
    #ifdef USE_SHADOWMAP
    #if NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow celNearShadow = directionalLightShadows[0];
    float celShadowMask = getShadow(
      directionalShadowMap[0],
      celNearShadow.shadowMapSize,
      celNearShadow.shadowIntensity,
      celNearShadow.shadowBias,
      celNearShadow.shadowRadius,
      vDirectionalShadowCoord[0]
    );
    #if NUM_DIR_LIGHT_SHADOWS > 1
    DirectionalLightShadow celFarShadow = directionalLightShadows[1];
    float celFarMask = getShadow(
      directionalShadowMap[1],
      celFarShadow.shadowMapSize,
      celFarShadow.shadowIntensity,
      celFarShadow.shadowBias,
      celFarShadow.shadowRadius,
      vDirectionalShadowCoord[1]
    );
    // Blend near->far by view distance (camera at view-space origin). Mirrors the
    // pure cascadeBlendWeight in core/shadowCascade.ts verbatim.
    float celViewDist = length(vViewPos);
    float celCascadeW = uCascadeSplit.y <= 0.0
      ? 0.0
      : clamp((celViewDist - (uCascadeSplit.x - uCascadeSplit.y)) / uCascadeSplit.y, 0.0, 1.0);
    celShadowMask = mix(celShadowMask, celFarMask, celCascadeW);
    #endif
    diffuse *= celShadowMask * uShadowFade;
    #endif
    #endif
    ${colorInit}${tempGradeBlock}

    // Rim: brightest where the surface turns away from the camera.
    vec3 V = normalize(-vViewPos);
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower) * uRimIntensity;
    color += uRimColor * rim;

    #ifdef SPECULAR
      // Soft specular: Blinn-Phong half-vector, exponent mapped from uRoughness
      // (lower roughness -> tighter, shinier highlight). Lit by uSunColor (sun-
      // tinted, never white), masked by NdotL so back faces stay dark, bounded by
      // uSpecularIntensity so the highlight never exceeds the sun tint.
      vec3 H = normalize(L + V);
      float NdotH = clamp(dot(N, H), 0.0, 1.0);
      float shininess = pow(2.0, mix(10.0, 3.0, clamp(uRoughness, 0.0, 1.0)));
      float spec = pow(NdotH, shininess) * uSpecularIntensity * NdL;
      color += uSunColor * spec;
    #endif
${envReflectBlock}
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
