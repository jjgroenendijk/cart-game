import * as THREE from "three";
import { FADE_DISCARD_GLSL, FADE_GLSL, FADE_UNIFORM_GLSL } from "./fade";

/**
 * Inverted-hull outline: render the source geometry BackSide, expanded along
 * the view-space normal so the back-face silhouette peeks out around the
 * mesh edges. Thickness is constant in SCREEN space (clip-space offset
 * scaling with clip.w) so outlines neither thin out at distance nor balloon
 * up close — the two failure modes of the old world-space thickness.
 *
 * depthWrite=false + polygonOffset + renderOrder=-1: the outline draws
 * before its parent mesh (which overdraws the interior), avoiding z-fighting
 * on coplanar parts (spoiler, seat). Convex low-poly meshes throughout.
 */
/**
 * Outline fade coupling to a streamed prop's `uFade`:
 * - `off`    — no fade (default; static outlines).
 * - `dither` — Bayer-discard the hull in step with a dither-fading parent.
 * - `haze`   — scale the hull THICKNESS by `uFade` so the rim grows in from
 *   zero width (invisible, collapsed onto the mesh) as the parent materialises
 *   out of the haze. No discard, no stipple — the black rim never sparkles
 *   against the sky. Pairs with the cel `fadeHaze` prop material.
 */
export type OutlineFade = "off" | "dither" | "haze";

const OUTLINE_VERT = /* glsl */ `
  uniform float uThickness;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec4 clip = projectionMatrix * mvPos;
    // Constant pixel width: post-divide NDC offset = uThickness regardless
    // of view depth.
    clip.xy += viewNormal.xy * uThickness * clip.w;
    gl_Position = clip;
  }
`;

// Haze-grow variant: thickness scales with uFade so the rim widens from zero
// (collapsed onto the mesh -> hidden) to full as the parent hazes in.
const OUTLINE_VERT_HAZE = /* glsl */ `
  uniform float uThickness;
  uniform float uFade;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec4 clip = projectionMatrix * mvPos;
    clip.xy += viewNormal.xy * uThickness * clamp(uFade, 0.0, 1.0) * clip.w;
    gl_Position = clip;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

// Dither-fade variant (see ./fade.ts): the hull must dissolve in step with
// its fading parent mesh or the black rim would pop at full strength.
const OUTLINE_FRAG_FADE = /* glsl */ `
  ${FADE_UNIFORM_GLSL}${FADE_GLSL}
  void main() {
    ${FADE_DISCARD_GLSL}
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

export class InvertedHullMaterial extends THREE.ShaderMaterial {
  constructor(thickness = 0.02, fade: OutlineFade = "off") {
    const uniforms: Record<string, THREE.IUniform> =
      fade === "off"
        ? { uThickness: { value: thickness } }
        : { uThickness: { value: thickness }, uFade: { value: 1 } };
    super({
      uniforms,
      vertexShader: fade === "haze" ? OUTLINE_VERT_HAZE : OUTLINE_VERT,
      fragmentShader: fade === "dither" ? OUTLINE_FRAG_FADE : OUTLINE_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }

  get thickness(): number {
    return this.uniforms.uThickness.value as number;
  }

  set thickness(v: number) {
    this.uniforms.uThickness.value = v;
  }
}

/**
 * Attach an inverted-hull outline as a child of `mesh`, sharing the source
 * geometry (no de-index; CelMaterial shades flat in-shader so the shared
 * smooth normals give a clean silhouette). Returns the outline mesh.
 * `fade` opts the hull into a `uFade`-coupled fade (`dither` discard or `haze`
 * thickness grow-in) for streamed props; the caller drives `uFade` alongside
 * the parent material's. `off` (default) is a static outline.
 */
export function addOutline(
  mesh: THREE.Mesh,
  thickness = 0.02,
  fade: OutlineFade = "off",
): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, new InvertedHullMaterial(thickness, fade));
  outline.renderOrder = -1;
  // Tag so the kart LOD pass skips it: the inflated back-face hull must never
  // cast shadows (it would stamp a fat halo into the shadow map).
  outline.userData.outlineHull = true;
  outline.castShadow = false;
  outline.receiveShadow = false;
  mesh.add(outline);
  return outline;
}

/**
 * Detach an outline from its parent and dispose its (unique) material. The
 * geometry is shared with the source mesh and is NOT disposed here.
 */
export function removeOutline(outline: THREE.Mesh): void {
  outline.removeFromParent();
  const mat = outline.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}
