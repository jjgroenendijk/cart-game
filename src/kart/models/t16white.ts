/**
 * Imported kart: a Group-B-style rally hatchback (white livery), generated
 * from a single image with the Hunyuan3D pipeline (see
 * experiments/hunyuan3d-kart/). See quattro.ts for the wiring pattern this
 * shares; t16red.ts is the same body, red livery, generated separately.
 */

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { DEFAULT_TUNING } from "../KartController";
import { addOutline } from "../../materials/outline";
import { BODY_OUTLINE, stance } from "./parts";
import type { KartModelDef } from "./types";
import t16whiteObj from "./t16white.obj?raw";

// The mesh's nose points +Z; game forward is -Z, so spin it 180 about up.
const FACE_FLIP = true;

export const t16whiteModel: KartModelDef = {
  id: "t16white",
  name: "205 T16",
  colorway: "glacier",
  tuning: { ...DEFAULT_TUNING },
  silhouette: { bodyDims: [1.05, 0.72, 1.95], tireRadius: 0.35, noseZ: -0.98, spoilerH: 0.07 },
  stance: stance(0.58, -0.76, 0.8),
  ownWheels: true,
  build(ctx) {
    const root = new OBJLoader().parse(t16whiteObj);

    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    for (const m of meshes) {
      m.geometry.computeVertexNormals();
      m.material = ctx.bodyMat;
      m.castShadow = true;
      m.receiveShadow = true;
      addOutline(m, BODY_OUTLINE);
    }

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = ctx.silhouette.bodyDims[2] / size.z;

    root.position.sub(center);
    if (FACE_FLIP) root.rotation.y = Math.PI;

    const rig = new THREE.Group();
    rig.add(root);
    rig.scale.setScalar(scale);
    const groundY = -(0.35 + ctx.silhouette.tireRadius);
    rig.position.y = groundY + (size.y * scale) / 2;
    ctx.group.add(rig);
  },
};
