import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";
import {
  DETAIL_ALBEDO_SNIPPET,
  DETAIL_DEFAULTS,
  DETAIL_NOISE_FN,
  DETAIL_NORMAL_SNIPPET,
} from "./terrainDetail";

/** Shared terrain-wetness uniform (054). Terrain CelMaterials opt in via
 *  wetness:true; Environment writes .value once/frame. Default 0 = no effect. */
export const wetnessUniform = { uWetness: { value: 0 } };

export interface CelOpts {
  /** Linear base color. */
  color?: number;
  /** Use dFdx/dFdy face normals (WebGL2) — no geometry de-indexing needed. */
  flatShading?: boolean;
  /** Opt-in hard specular band (off by default). */
  specular?: boolean;
  /** Number of discrete diffuse bands. */
  bands?: number;
  /** Band-edge AA width in band-fraction units (0 = hard floor). Default 0.12. */
  bandEdge?: number;
  rimColor?: number;
  rimPower?: number;
  rimIntensity?: number;
  /**
   * Multiply uColor by the per-vertex `color` attribute. Required for painted
   * terrain (road/grass/rock via vertex colors). The geometry must carry a
   * `color` BufferAttribute; this flag declares the attribute + varying.
   */
  vertexColors?: boolean;
  /**
   * Per-pixel normal from a height texture (terrain). When set, the fragment
   * reconstructs the world-space surface normal by finite-differencing the
   * heightmap at the fragment's world (x,z), independent of mesh
   * triangulation. Eliminates the diagonal/diamond cel-band artifacts that
   * appear when cel-quantizing a per-vertex normal linearly interpolated
   * across each quad's diagonal fold. Used by TerrainChunkManager.
   */
  heightMap?: HeightMapField;
  /**
   * Discrete diffuse banding (toon shading). Defaults on. Set false for
   * smooth lambert: terrain uses a smooth height normal, so cel-quantising
   * its N.L renders the contour lines as visible stripes across the
   * landscape. Smooth (no bands) reads as soft terrain shading.
   */
  cel?: boolean;
  /**
   * Bilinearly interpolate the heightmap neighbour taps so the per-pixel
   * normal is continuous (C0) instead of piecewise-constant per texel,
   * eliminating the ~texel-size square shade grid. Defaults on when
   * heightMap is set. Off reverts to the 4-tap nearest path.
   */
  heightSmooth?: boolean;
  /**
   * Opt terrain into the shared uWetness darkening channel (054). When set,
   * adds the WETNESS define + binds the shared {@link wetnessUniform}.uWetness
   * reference so a single Environment write fans out to every terrain chunk's
   * material. Default off => no uWetness uniform + no WETNESS define (the
   * shader never references it -> byte-identical to the pre-054 path).
   */
  wetness?: boolean;
  /**
   * Procedural fbm surface detail (069): mottle the LINEAR albedo and perturb
   * the per-pixel heightmap normal with the fbm gradient. Only meaningful when
   * heightMap is set (the detail GLSL lives inside the HEIGHT_MAP block and
   * keys on vWorldXZ); ignored otherwise. Off => no SURFACE_DETAIL define, no
   * uDetail* uniforms, fragment shader byte-identical to pre-069.
   */
  surfaceDetail?: boolean;
  /**
   * Compile-time octave count for the surface-detail fbm loop (only used when
   * surfaceDetail + heightMap are set). Baked into the shader as
   * `#define DETAIL_OCTAVES`; changing it requires a material rebuild
   * (needsUpdate on the existing material is not enough). A tier change that
   * alters octaves must rebuild the material, not use the surfaceDetail
   * setter. Defaults to DETAIL_DEFAULTS.octaves (3).
   */
  detailOctaves?: number;
}

/**
 * Heightmap descriptor for the {@link CelMaterial} per-pixel normal path.
 * The texture covers a square world region; texel [0,0] sits at `origin`.
 */
export interface HeightMapField {
  texture: THREE.Texture;
  /** World (x, z) at the texture's [0,0] texel corner (min corner). */
  origin: [number, number];
  /** World span the texture covers along BOTH axes (square). */
  size: number;
  /** Texels per axis (texels are square). */
  texels: number;
}

const CEL_VERT = /* glsl */ `
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  #ifdef VERTEX_COLORS
  // The color attribute is injected by three.js (USE_COLOR) when vertexColors
  // is on; we only add the varying here.
  varying vec3 vColor;
  #endif
  #ifdef HEIGHT_MAP
  varying vec2 vWorldXZ;
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
    #if defined(HEIGHT_MAP) || NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    #endif
    #ifdef HEIGHT_MAP
    vWorldXZ = worldPosition.xz;
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

// SURFACE_DETAIL header pieces (069). Concatenated with the octave count +
// DETAIL_NOISE_FN at build time only when surfaceDetail is on, so the off-path
// fragment stays byte-identical (these consts are never referenced when off).
const DETAIL_HEADER_PREFIX = `
#ifdef SURFACE_DETAIL
    uniform float uDetailStrength;
    uniform float uDetailScale;
    uniform float uDetailBump;
    #define DETAIL_OCTAVES `;
const DETAIL_HEADER_SUFFIX = `
#endif`;

function celFragmentShader(
  heightSmooth: boolean,
  wetness: boolean,
  surfaceDetail: boolean,
  detailOctaves: number,
): string {
  const smoothFn = heightSmooth ? HEIGHT_SMOOTH_FN : "";
  const taps = heightSmooth
    ? `${HEIGHT_TAPS_SMOOTH}${HEIGHT_TAPS_NEAREST}${HEIGHT_TAPS_END}`
    : HEIGHT_TAPS_NEAREST;
  // SURFACE_DETAIL injection. Each helper is "" when off and is concatenated
  // onto an existing template token with NO intervening whitespace, so the
  // off-path fragment is byte-identical to pre-069. All detail GLSL is nested
  // inside #ifdef HEIGHT_MAP (detail keys on vWorldXZ) and guarded by
  // #ifdef SURFACE_DETAIL.
  // Uniforms + DETAIL_OCTAVES compile constant + noise fns, in the HEIGHT_MAP
  // header next to the height uniforms.
  const detailHeader = surfaceDetail
    ? DETAIL_HEADER_PREFIX + detailOctaves + DETAIL_NOISE_FN + DETAIL_HEADER_SUFFIX
    : "";
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
  ${wetness ? "#ifdef WETNESS\n  uniform float uWetness;\n  #endif" : ""}

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
  #include <common>
  #include <shadowmap_pars_fragment>

  void main() {
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
    ${detailAlbedo}${wetnessMul}

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

    gl_FragColor = vec4(color, 1.0);
  }
  `;
}

/**
 * Custom cel ShaderMaterial: lambert snapped to N bands, rim term, and an
 * optional hard specular band. flatShading toggles per-face normals via
 * fragment derivatives (no flatGeometry de-indexing -> no 3x VRAM). Shares
 * the module-level lightUniforms so the Renderer fans a single per-frame
 * sun/ambient write out to every CelMaterial instance.
 *
 * Outputs LINEAR color; tone mapping + output color space are applied by the
 * composer's OutputPass (Renderer), not here.
 */
export class CelMaterial extends THREE.ShaderMaterial {
  constructor(opts: CelOpts = {}) {
    const defines: Record<string, string> = {};
    if (opts.flatShading) defines["FLAT"] = "";
    if (opts.specular) defines["SPECULAR"] = "";
    if (opts.vertexColors) defines["VERTEX_COLORS"] = "";
    if (opts.cel === false) defines["SMOOTH_DIFFUSE"] = "";
    // heightSmooth defaults on when heightMap is set; off reverts to the
    // 4-tap nearest path (bit-identical fallback, no sampleH in source).
    const useSmooth = !!opts.heightMap && opts.heightSmooth !== false;
    if (opts.heightMap) {
      defines["HEIGHT_MAP"] = "";
      if (useSmooth) defines["HEIGHT_SMOOTH"] = "";
    }
    if (opts.wetness) defines["WETNESS"] = "";
    // surfaceDetail is only meaningful with heightMap (detail GLSL lives inside
    // the HEIGHT_MAP block + keys on vWorldXZ). Guarded here so the off-path
    // (no heightMap, or surfaceDetail false) emits no define + no uniforms +
    // a byte-identical fragment shader.
    const useDetail = !!(opts.surfaceDetail && opts.heightMap);
    if (useDetail) defines["SURFACE_DETAIL"] = "";

    const uniforms: Record<string, THREE.IUniform> = {
      ...lightUniforms,
      // Light + shadow uniforms (directionalShadowMatrix/Map,
      // directionalLightShadows) so the renderer can bind the sun shadow map.
      // `lights` below makes three add the USE_SHADOWMAP + NUM_DIR_LIGHT_SHADOWS
      // defines; the cel shading itself still reads the custom uSunDir/uSunColor.
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uBands: { value: opts.bands ?? 3 },
      uBandEdge: { value: opts.bandEdge ?? 0.12 },
      uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xffffff) },
      uRimPower: { value: opts.rimPower ?? 2.0 },
      uRimIntensity: { value: opts.rimIntensity ?? 0.3 },
    };
    if (opts.specular) {
      uniforms.uSpecularShininess = { value: 32 };
      uniforms.uSpecularIntensity = { value: 0.6 };
    }
    if (opts.heightMap) {
      const hm = opts.heightMap;
      uniforms.uHeightMap = { value: hm.texture };
      uniforms.uHeightOrigin = { value: new THREE.Vector2(hm.origin[0], hm.origin[1]) };
      uniforms.uHeightSize = { value: hm.size };
      uniforms.uHeightTexelWorld = { value: hm.size / hm.texels };
    }
    if (opts.wetness) {
      // Bind the SHARED reference (not a spread copy): the value is a number
      // primitive, so spreading would copy it and one Environment write would
      // NOT fan out. Mirrors the lightUniforms by-reference pattern.
      uniforms.uWetness = wetnessUniform.uWetness;
    }
    if (useDetail) {
      // Detail uniforms default to DETAIL_DEFAULTS; commit 3 (tier wiring)
      // overlays terrainDetailForTier(...) here. Octaves is a compile constant
      // (DETAIL_OCTAVES), not a uniform.
      uniforms.uDetailStrength = { value: DETAIL_DEFAULTS.strength };
      uniforms.uDetailScale = { value: DETAIL_DEFAULTS.scale };
      uniforms.uDetailBump = { value: DETAIL_DEFAULTS.bump };
    }

    super({
      defines,
      uniforms,
      vertexShader: CEL_VERT,
      fragmentShader: celFragmentShader(
        useSmooth,
        !!opts.wetness,
        useDetail,
        opts.detailOctaves ?? DETAIL_DEFAULTS.octaves,
      ),
      // Lights ON so three injects the USE_SHADOWMAP / NUM_DIR_SHADOWS
      // defines and binds the sun's shadow map; the cel shading itself still
      // reads the custom uSunDir/uSunColor (no three light chunks included).
      lights: true,
    });
    // Keep three.js's own bookkeeping in sync (buffer binding path).
    this.vertexColors = opts.vertexColors ?? false;
  }

  /** Toggle face-normal (flat) shading at runtime; recompiles on change. */
  get flatShading(): boolean {
    return "FLAT" in this.defines;
  }

  set flatShading(v: boolean) {
    if (v) this.defines["FLAT"] = "";
    else delete this.defines["FLAT"];
    this.needsUpdate = true;
  }

  /**
   * Runtime toggle for the SURFACE_DETAIL branch (mirrors flatShading): flips
   * the define + needsUpdate so the fragment recompiles. Only meaningful on a
   * material constructed with heightMap; toggling does NOT change the baked
   * DETAIL_OCTAVES compile constant or the injected GLSL body. A tier change
   * that alters octaves must rebuild the material (commit 3's job), not use
   * this setter.
   */
  get surfaceDetail(): boolean {
    return "SURFACE_DETAIL" in this.defines;
  }

  set surfaceDetail(v: boolean) {
    if (v) this.defines["SURFACE_DETAIL"] = "";
    else delete this.defines["SURFACE_DETAIL"];
    this.needsUpdate = true;
  }
}

/** Factory matching the plan's makeCel({flatShading}) call sites. */
export function makeCel(opts: CelOpts = {}): CelMaterial {
  return new CelMaterial(opts);
}
