import * as THREE from "three";

type MaterialObject = THREE.Object3D & {
  material?: THREE.Material | THREE.Material[];
};

/**
 * Temporarily hides visible drawables whose original materials all opt out of
 * depth writes. Override materials otherwise turn transparent weather/VFX
 * particles into opaque rectangles in the shared depth/normal captures.
 *
 * Returns a restoration callback so capture passes can restore visibility in
 * a finally block even when WebGL rendering throws.
 */
export function suppressNonDepthWritingObjects(root: THREE.Object3D): () => void {
  const suppressed: THREE.Object3D[] = [];

  root.traverse((object) => {
    if (!object.visible) return;

    const material = (object as MaterialObject).material;
    if (!material) return;

    const materials = Array.isArray(material) ? material : [material];
    if (materials.length === 0 || !materials.every((entry) => entry.depthWrite === false)) return;

    object.visible = false;
    suppressed.push(object);
  });

  return () => {
    for (const object of suppressed) object.visible = true;
  };
}
