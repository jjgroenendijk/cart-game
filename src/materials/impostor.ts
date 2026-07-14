import * as THREE from "three";
import { lightUniforms } from "./lightUniforms";
import { FADE_DISCARD_GLSL, FADE_GLSL, FADE_UNIFORM_GLSL } from "./fade";

/**
 * Runtime-baked foliage impostors (200). Distant big flora (trees) is too
 * expensive to draw as full 3D geometry out to the fog horizon, so each
 * distinct prototype is baked ONCE at world build into an albedo + normal
 * atlas (see ImpostorField.bakeImpostorAtlas) and then drawn as an instanced,
 * camera-facing quad (billboard) that samples the atlas.
 *
 * The card stores MATERIAL INPUTS, not final lighting: the albedo atlas holds
 * the prototype's LINEAR base colour (+ silhouette in alpha) and the normal
 * atlas holds the prototype's packed surface normal (captured from a fixed
 * side view). ImpostorMaterial RELIGHTS them every frame with the SAME shared
 * light uniforms, cel banding, and fog CelMaterial uses, so impostors track
 * the day/night cycle and match the painterly cel look of the near meshes.
 *
 * Billboard mode is YAW-ONLY: the quad rotates about world +Y to face the
 * camera horizontally (foliage reads the same from any ground-level heading;
 * octahedral multi-view is a follow-up only if a clear need appears). The card
 * basis (right, up, facing) is rebuilt per vertex; the decoded normal is
 * expressed in that basis so relighting rotates WITH the billboard.
 *
 * No colliders: impostors are pure visuals (ImpostorField never touches
 * physics). Alpha-test discards the silhouette so the card reads as foliage,
 * not a rectangle.
 */

/** Square-ish atlas grid for `cells` prototype views. Pure (no GL/DOM). */
export interface AtlasLayout {
  cols: number;
  rows: number;
  cells: number;
}

/** UV sub-rect of one atlas cell (origin + span in [0,1] texture space). */
export interface CellRect {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

/**
 * Lay out `cells` prototype views into a square-ish grid (cols = ceil(sqrt),
 * rows = ceil(cells/cols)). Pure + deterministic so the bake, the instance UV
 * attributes, and the tests all agree on cell placement without a GL context.
 */
export function impostorAtlasLayout(cells: number): AtlasLayout {
  const n = Math.max(1, Math.floor(cells));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows, cells: n };
}

/**
 * UV rect of cell `index` (row-major, origin bottom-left to match GL texture
 * space). Pure; shared by bake viewport math + per-instance aUv attributes.
 */
export function impostorCellRect(index: number, layout: AtlasLayout): CellRect {
  const i = index < 0 ? 0 : index >= layout.cells ? layout.cells - 1 : index;
  const du = 1 / layout.cols;
  const dv = 1 / layout.rows;
  const col = i % layout.cols;
  const row = Math.floor(i / layout.cols);
  return { u0: col * du, v0: row * dv, du, dv };
}

/**
 * Mesh-vs-impostor streaming selection (200). True => draw the cheap billboard
 * for this distance; false => keep the full 3D mesh. `hysteresis` widens the
 * switch band by the current state so a prop hovering on the boundary does not
 * flap: once impostor, it stays impostor until `dist` drops below start -
 * hysteresis; once mesh, it stays mesh until `dist` clears start + hysteresis.
 * Pure + unit-tested; ImpostorField/streaming owns the actual swap.
 */
export function useImpostor(
  dist: number,
  startRadius: number,
  hysteresis = 0,
  currentlyImpostor = false,
): boolean {
  if (currentlyImpostor) return dist > startRadius - hysteresis;
  return dist >= startRadius + hysteresis;
}

/** Default alpha-test cutoff for the baked silhouette. */
export const IMPOSTOR_ALPHA_TEST = 0.5;

export interface ImpostorMaterialOpts {
  /** LINEAR base albedo atlas (rgb) + silhouette coverage (alpha). */
  albedo: THREE.Texture;
  /** Packed side-view normal atlas (rgb = normal * 0.5 + 0.5). */
  normal: THREE.Texture;
  /** Discrete diffuse bands (mirror CelMaterial; default 3). */
  bands?: number;
  /** Band-edge AA width in band-fraction units (default 0.12, cel parity). */
  bandEdge?: number;
  /** Silhouette alpha-test cutoff (default IMPOSTOR_ALPHA_TEST). */
  alphaTest?: number;
  /** Linear distance fog toward the scene fog colour (default ON, cel parity). */
  fog?: boolean;
}

// Yaw-billboard vertex shader. Rebuilds the card basis per vertex from the
// world camera position (cameraPosition is a three built-in): `facing` is the
// horizontal camera direction, `up` is world +Y, `right = up x facing`. The
// quad (PlaneGeometry, corners in [-0.5,0.5]) is sized by the per-instance
// aSize (world width, height already scaled) and rooted at the instance base
// (y in [0,1]*height), so the trunk foot sits on the terrain like the mesh.
const IMPOSTOR_VERT = /* glsl */ `
  attribute vec2 aSize; // world card width, height (per-instance, scaled)
  attribute vec4 aUv;   // atlas cell rect: u0, v0, du, dv
  varying vec2 vUv;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vFacing;
  varying float vViewDepth;
  void main() {
    vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - center;
    toCam.y = 0.0;
    vec3 facing = normalize(toCam);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, facing));
    vec3 world = center
      + right * (position.x * aSize.x)
      + up * ((position.y + 0.5) * aSize.y);
    vRight = right;
    vUp = up;
    vFacing = facing;
    vUv = aUv.xy + (position.xy + 0.5) * aUv.zw;
    vec4 viewPos = viewMatrix * vec4(world, 1.0);
    vViewDepth = -viewPos.z;
    gl_Position = projectionMatrix * viewPos;
  }
`;

// Fragment: alpha-test the silhouette, decode the card-space normal, rotate it
// into world space via the card basis (so lighting turns WITH the billboard),
// then relight with the SAME shared sun/ambient uniforms + cel band math + fog
// CelMaterial uses. Outputs LINEAR (OutputPass applies ACES + sRGB).
function impostorFragment(fog: boolean): string {
  const fogUniforms = fog
    ? "\n  uniform vec3 fogColor;\n  uniform float fogNear;\n  uniform float fogFar;"
    : "";
  const fogApply = fog
    ? `
    float fogFactor = smoothstep(fogNear, fogFar, vViewDepth);
    color = mix(color, fogColor, fogFactor);`
    : "";
  return /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform float uAlphaTest;
  uniform vec3 uSunDir;   // view space, normalized
  uniform vec3 uSunColor; // linear
  uniform vec3 uAmbient;  // linear
  uniform float uBands;
  uniform float uBandEdge;
  ${FADE_UNIFORM_GLSL}${fogUniforms}
  varying vec2 vUv;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vFacing;
  varying float vViewDepth;
  ${FADE_GLSL}
  void main() {
    ${FADE_DISCARD_GLSL}
    vec4 tex = texture2D(uAlbedo, vUv);
    if (tex.a < uAlphaTest) discard;

    // Card-space normal (x=right, y=up, z=toward camera) -> world via the card
    // basis so relighting rotates with the yaw billboard; then world -> view.
    vec3 nCard = normalize(texture2D(uNormal, vUv).xyz * 2.0 - 1.0);
    vec3 Nworld = normalize(nCard.x * vRight + nCard.y * vUp + nCard.z * vFacing);
    vec3 N = normalize((viewMatrix * vec4(Nworld, 0.0)).xyz);

    vec3 L = normalize(uSunDir);
    float NdL = clamp(dot(N, L), 0.0, 1.0);

    // Cel banding: identical math to CelMaterial's default (non-SMOOTH) path so
    // impostors quantise into the same toon steps as the near meshes.
    float scaled = NdL * uBands;
    float bandIdx = floor(scaled);
    float f = scaled - bandIdx;
    float bandLow = bandIdx / uBands;
    float bandHigh = (bandIdx + 1.0) / uBands;
    float w = smoothstep(1.0 - uBandEdge, 1.0, f);
    float band = clamp(mix(bandLow, bandHigh, w), 1.0 / uBands, 1.0);

    vec3 base = tex.rgb;
    vec3 color = base * uSunColor * band + base * uAmbient;
    ${fogApply}
    gl_FragColor = vec4(color, 1.0);
  }
  `;
}

/**
 * Instanced yaw-billboard material for baked foliage impostors (200). Shares
 * `lightUniforms` by reference (single per-frame sun/ambient write fans out to
 * every impostor, same as CelMaterial) and mirrors cel banding + fog so the
 * distant cards match the near meshes under the day/night cycle. `uFade`
 * (default 1) drives the ordered-dither cross-dissolve when a bundle swaps
 * between mesh and impostor. Opaque (depth-writing); the silhouette is an
 * alpha-test discard, never alpha blending.
 */
export class ImpostorMaterial extends THREE.ShaderMaterial {
  constructor(opts: ImpostorMaterialOpts) {
    const useFog = opts.fog ?? true;
    const uniforms: Record<string, THREE.IUniform> = {
      ...lightUniforms,
      uAlbedo: { value: opts.albedo },
      uNormal: { value: opts.normal },
      uAlphaTest: { value: opts.alphaTest ?? IMPOSTOR_ALPHA_TEST },
      uBands: { value: opts.bands ?? 3 },
      uBandEdge: { value: opts.bandEdge ?? 0.12 },
      uFade: { value: 1 },
    };
    if (useFog) {
      // three.js refreshFogUniforms writes these each frame from scene.fog;
      // defaults match the Renderer's day fog until the first write.
      uniforms.fogColor = { value: new THREE.Color(0xb6ad9e) };
      uniforms.fogNear = { value: 90 };
      uniforms.fogFar = { value: 360 };
    }
    super({
      uniforms,
      vertexShader: IMPOSTOR_VERT,
      fragmentShader: impostorFragment(useFog),
      // Impostors do not need shadow-map casting/receiving (they ARE the far
      // LOD); leave lights off so three injects no shadow chunks.
      fog: useFog,
      side: THREE.DoubleSide,
    });
  }
}
