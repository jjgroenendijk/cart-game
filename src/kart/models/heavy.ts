/** Mini-truck: tall body + cab, bull bar, twin exhaust stacks. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

export const heavyModel: KartModelDef = {
  id: "heavy",
  name: "Heavy",
  colorway: "violet",
  tuning: {
    ...DEFAULT_TUNING,
    mass: 340,
    maxSpeed: 32,
    engineForce: 9400,
    grip: 10.5,
    driftGrip: 1.9,
    maxSteerRate: 2.3,
    uprightTorque: 34,
  },
  silhouette: { bodyDims: [1.3, 0.45, 1.95], tireRadius: 0.42, noseZ: -1.0, spoilerH: 0.08 },
  stance: stance(0.74, -0.78, 0.86),
  build(ctx) {
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const bed = volume(
      ctx,
      new THREE.BoxGeometry(bw, bh, bd),
      ctx.bodyMat,
      0,
      -0.05,
      0,
      BODY_OUTLINE,
    );
    bed.receiveShadow = true;
    volume(
      ctx,
      new THREE.BoxGeometry(bw * 0.85, 0.42, 0.85),
      ctx.bodyMat,
      0,
      0.28,
      0.3,
      BODY_OUTLINE,
    );
    volume(ctx, new THREE.BoxGeometry(bw * 0.9, 0.06, 0.92), ctx.accentMat, 0, 0.53, 0.3);
    // Bull bar: horizontal dark tube spanning the nose + two posts.
    const bar = volume(
      ctx,
      new THREE.CylinderGeometry(0.06, 0.06, bw * 0.9, 10),
      ctx.darkMat,
      0,
      -0.02,
      ctx.silhouette.noseZ - 0.12,
    );
    bar.rotation.z = Math.PI / 2;
    const postZ = ctx.silhouette.noseZ - 0.12;
    detail(ctx, new THREE.BoxGeometry(0.06, 0.26, 0.06), ctx.darkMat, -0.3, -0.14, postZ);
    detail(ctx, new THREE.BoxGeometry(0.06, 0.26, 0.06), ctx.darkMat, 0.3, -0.14, postZ);
    driver(ctx, 0.36, 0.3, 0.2);
    // Twin exhaust stacks behind the cab with accent tips.
    for (const sx of [-1, 1]) {
      const x = sx * bw * 0.34;
      volume(ctx, new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), ctx.darkMat, x, 0.35, 0.78);
      detail(ctx, new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), ctx.accentMat, x, 0.62, 0.78);
    }
  },
};
