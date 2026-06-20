import * as THREE from "three";

/**
 * Shared lighting uniforms consumed by CelMaterial (cel.ts) and the inverted
 * hull outline (outline.ts). The Renderer writes these once per frame via
 * updateLightUniforms; every material that spreads `lightUniforms` into its
 * own uniforms sees the update (shared by reference).
 *
 * uSunDir is stored in VIEW space (post viewMatrix transform) so cel/rim
 * math can use camera-at-origin convention without a per-frame camera
 * position uniform. uSunColor / uAmbient are LINEAR.
 */
export const lightUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.25, 0.25, 0.28) },
} satisfies Record<string, THREE.IUniform>;

export type LightUniforms = typeof lightUniforms;

/**
 * Write sun direction (world -> view space), sun color, and ambient into the
 * shared light uniforms. Pure (no WebGL) so it is unit-testable under jsdom;
 * Renderer.render calls this once per frame with the active camera's inverse
 * matrix.
 */
export function updateLightUniforms(
  uniforms: LightUniforms,
  sunDirWorld: THREE.Vector3,
  sunColor: THREE.Color,
  ambient: THREE.Color,
  viewMatrix: THREE.Matrix4,
): void {
  uniforms.uSunDir.value.copy(sunDirWorld).transformDirection(viewMatrix).normalize();
  uniforms.uSunColor.value.copy(sunColor);
  uniforms.uAmbient.value.copy(ambient);
}
