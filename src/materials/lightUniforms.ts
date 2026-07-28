import * as THREE from "three";

/**
 * Default sun direction in world space. Single source of truth shared by
 * Renderer (Sky sunPosition, DirectionalLight position, shadow target) and
 * the cel materials (via uSunDir view-space). Computed once at module
 * load from elevation/azimuth constants so callers can read
 * `lightUniforms.uSunDirWorld.value` without re-deriving.
 */
const SUN_ELEVATION = 28;
const SUN_AZIMUTH = 135;

function defaultSunDirWorld(): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

/**
 * Shared lighting uniforms consumed by CelMaterial (cel.ts). The Renderer
 * writes these once per frame via
 * updateLightUniforms; every material that spreads `lightUniforms` into its
 * own uniforms sees the update (shared by reference).
 *
 * uSunDir is stored in VIEW space (post viewMatrix transform) so cel/rim
 * math can use camera-at-origin convention without a per-frame camera
 * position uniform. uSunDirWorld is the world-space source of truth (drives
 * Sky + DirectionalLight + shadow target). uSunColor / uAmbient are LINEAR.
 */
export const lightUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunDirWorld: { value: defaultSunDirWorld() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.25, 0.25, 0.28) },
  /** Cast-shadow fade 0..1 (default 1 = full shadows; Renderer writes dayCycle.shadowFade). */
  uShadowFade: { value: 1 },
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
  uniforms.uSunDirWorld.value.copy(sunDirWorld);
  uniforms.uSunDir.value.copy(sunDirWorld).transformDirection(viewMatrix).normalize();
  uniforms.uSunColor.value.copy(sunColor);
  uniforms.uAmbient.value.copy(ambient);
}

/**
 * Place a target vector at `distance` units along `sunDirWorld` (anchored at
 * origin). Pure helper used by Renderer for the DirectionalLight position +
 * shadow target offset; exported for jsdom-safe unit testing of the alignment
 * math (Renderer itself instantiates WebGLRenderer and cannot run in jsdom).
 */
export function sunWorldPosition(
  sunDirWorld: THREE.Vector3,
  target: THREE.Vector3,
  distance: number,
): THREE.Vector3 {
  return target.copy(sunDirWorld).multiplyScalar(distance);
}
