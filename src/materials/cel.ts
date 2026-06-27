import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";

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
}

const CEL_VERT = /* glsl */ `
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  #ifdef VERTEX_COLORS
  // The color attribute is injected by three.js (USE_COLOR) when vertexColors
  // is on; we only add the varying here.
  varying vec3 vColor;
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
    // Shadow coords: transformed already carries instanceMatrix, so build
    // worldPosition with modelMatrix only (NOT the shadowmap_vertex chunk,
    // which would double-apply instanceMatrix and break instanced decor).
    #if NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    #pragma unroll_loop_start
    for (int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i++) {
      vDirectionalShadowCoord[i] = directionalShadowMatrix[i] * worldPosition;
    }
    #pragma unroll_loop_end
    #endif
  }
`;

const CEL_FRAG = /* glsl */ `
  uniform vec3 uSunDir;     // view space, normalized
  uniform vec3 uSunColor;   // linear
  uniform vec3 uAmbient;    // linear
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

  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  #ifdef VERTEX_COLORS
  varying vec3 vColor;
  #endif
  #include <common>
  #include <shadowmap_pars_fragment>

  void main() {
    vec3 N;
    #ifdef FLAT
      vec3 dpdx = dFdx(vViewPos);
      vec3 dpdy = dFdy(vViewPos);
      N = normalize(cross(dpdx, dpdy));
    #else
      N = normalize(vViewNormal);
    #endif

    vec3 L = normalize(uSunDir);
    float NdL = clamp(dot(N, L), 0.0, 1.0);

    // Snap lambert into uBands discrete steps with a narrow AA transition at
    // each band edge (uBandEdge width in band-fraction units). The hard floor
    // stair-steps badly on curved geometry under a moving sun; smoothing only
    // the top sliver of each band keeps the toon look while removing the
    // staircase. clamp guarantees a lit floor (1/uBands). uBandEdge=0 reduces
    // to the original hard floor.
    float scaled = NdL * uBands;
    float bandIdx = floor(scaled);
    float f = scaled - bandIdx;
    float bandLow = bandIdx / uBands;
    float bandHigh = (bandIdx + 1.0) / uBands;
    float w = smoothstep(1.0 - uBandEdge, 1.0, f);
    float band = mix(bandLow, bandHigh, w);
    band = clamp(band, 1.0 / uBands, 1.0);

    // Per-vertex color modulates the linear base (terrain road/grass/rock).
    vec3 base = uColor;
    #ifdef VERTEX_COLORS
    base *= vColor;
    #endif

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
    );
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

    super({
      defines,
      uniforms,
      vertexShader: CEL_VERT,
      fragmentShader: CEL_FRAG,
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
}

/** Factory matching the plan's makeCel({flatShading}) call sites. */
export function makeCel(opts: CelOpts = {}): CelMaterial {
  return new CelMaterial(opts);
}
