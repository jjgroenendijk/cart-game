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
  constructor(thickness = 0.02, fade = false) {
    super({
      uniforms: fade
        ? { uThickness: { value: thickness }, uFade: { value: 1 } }
        : { uThickness: { value: thickness } },
      vertexShader: OUTLINE_VERT,
      fragmentShader: fade ? OUTLINE_FRAG_FADE : OUTLINE_FRAG,
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
 * `fade` opts the hull into the dither-fade uniform (streamed props); the
 * caller drives `uFade` alongside the parent material's.
 */
export function addOutline(mesh: THREE.Mesh, thickness = 0.02, fade = false): THREE.Mesh {
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
