import * as THREE from "three";
import type { CelMaterial } from "../materials/cel";
import { EMISSIVE_LAYER } from "../materials/emissiveCapture";

/**
 * 315 build a layer-3-only sibling clone mesh sharing the visible mesh's
 * geometry + the shared emissive-output material. Frozen matrix matches the
 * source position; the main RenderPass skips layer 3 so only EmissiveCapturePass
 * draws it. The clone never disposes its geometry/material (owned elsewhere).
 */
export function createEmissiveClone(
  material: CelMaterial,
  geometry: THREE.BufferGeometry,
  position: THREE.Vector3,
): THREE.Mesh {
  const emissive = new THREE.Mesh(geometry, material);
  emissive.layers.set(EMISSIVE_LAYER);
  emissive.receiveShadow = false;
  emissive.matrixAutoUpdate = false;
  emissive.position.copy(position);
  emissive.updateMatrix();
  return emissive;
}
