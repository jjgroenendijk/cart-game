/**
 * Shared fixed "studio" lighting for the isolated kart viewers (menu
 * KartPreview + dev garage/grid). The cel materials read sun/ambient uniforms
 * that live in the MAIN camera's view space and track the day cycle; an isolated
 * viewer has no such camera, so it swaps in these fixed uniform objects on every
 * cel material to light the kart from a stable studio direction regardless of
 * camera. Pure traversal — no renderer, no DOM — so it is safe under jsdom and a
 * no-op on any subtree without cel materials.
 */

import * as THREE from "three";

/** Studio key-light direction in the viewer camera's view space. */
export const STUDIO_SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.6).normalize();
/** Warm studio key-light color. */
export const STUDIO_SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9);
/** Cool studio fill/ambient. */
export const STUDIO_AMBIENT = new THREE.Color(0.4, 0.42, 0.48);

/** Swap viewer-local light uniform objects onto every cel material under root. */
export function applyStudioLight(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (!u || !u.uSunDir) continue;
      u.uSunDir = { value: STUDIO_SUN_DIR };
      u.uSunColor = { value: STUDIO_SUN_COLOR };
      u.uAmbient = { value: STUDIO_AMBIENT };
      u.uShadowFade = { value: 1 };
    }
  });
}
