/**
 * Imported kart: a Group-B-style rally coupe generated from a single image
 * with the Hunyuan3D pipeline (see experiments/hunyuan3d-kart/). Unlike the
 * procedural models this one loads a baked OBJ (inlined as text via Vite
 * `?raw` and parsed synchronously) so build() stays sync. It carries its
 * own wheels, so `ownWheels` tells the visual builder to skip the four
 * procedural wheel rigs.
 */

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { DEFAULT_TUNING } from "../KartController";
import { addOutline } from "../../materials/outline";
import { BODY_OUTLINE, stance } from "./parts";
import type { KartModelDef } from "./types";
import quattroObj from "./quattro.obj?raw";

// The mesh's nose points +Z; game forward is -Z, so spin it 180 about up.
const FACE_FLIP = true;

export const quattroModel: KartModelDef = {
  id: "quattro",
  name: "Quattro",
  colorway: "pearl",
  tuning: { ...DEFAULT_TUNING },
  silhouette: { bodyDims: [1.15, 0.75, 2.1], tireRadius: 0.35, noseZ: -1.05, spoilerH: 0.08 },
  stance: stance(0.64, -0.82, 0.88),
  ownWheels: true,
  build(ctx) {
    const root = new OBJLoader().parse(quattroObj);

    // Collect the source meshes before touching them: addOutline adds child
    // hull meshes, and we must not re-process those.
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    for (const m of meshes) {
      m.geometry.computeVertexNormals(); // export ships no normals; cel + outline need them
      m.material = ctx.bodyMat;
      m.castShadow = true;
      m.receiveShadow = true;
      addOutline(m, BODY_OUTLINE);
    }

    // Fit + seat: uniform-scale so the car length matches the body depth,
    // center on X/Z, drop the wheels onto the shared ground plane
    // (wheel y -0.35, tyre radius 0.35).
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = ctx.silhouette.bodyDims[2] / size.z;

    root.position.sub(center); // center the mesh at the rig origin
    if (FACE_FLIP) root.rotation.y = Math.PI;

    const rig = new THREE.Group();
    rig.add(root);
    rig.scale.setScalar(scale);
    const groundY = -(0.35 + ctx.silhouette.tireRadius);
    rig.position.y = groundY + (size.y * scale) / 2;
    ctx.group.add(rig);
  },
};
