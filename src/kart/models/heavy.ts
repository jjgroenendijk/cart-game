/** Mini-truck: rounded cab, open bed, bull bar, tanks, exhaust stacks. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { blob, capsule, detail, driver, stance, volume } from "./parts";
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
    const [bw, bh] = ctx.silhouette.bodyDims;
    // Open cargo bed at the rear — the one straight-edged part that keeps
    // the truck read against all the rounded karts.
    const bed = volume(
      ctx,
      new THREE.BoxGeometry(bw * 0.96, bh * 0.85, 0.9),
      ctx.bodyMat,
      0,
      -0.02,
      0.55,
    );
    bed.receiveShadow = true;
    // Rounded cab + hood up front, topped by an accent roof dome.
    blob(ctx, ctx.bodyMat, bw * 0.92, 0.66, 1.15, 0, 0.12, -0.42);
    const roof = volume(
      ctx,
      new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      ctx.accentMat,
      0,
      0.34,
      -0.42,
    );
    roof.scale.set(1.4, 0.8, 1.3);
    // Bull bar: dark tube spanning the nose on two capsule posts.
    const barZ = ctx.silhouette.noseZ - 0.1;
    const bar = volume(
      ctx,
      new THREE.CylinderGeometry(0.07, 0.07, bw * 0.85, 10),
      ctx.darkMat,
      0,
      -0.05,
      barZ,
    );
    bar.rotation.z = Math.PI / 2;
    detail(ctx, new THREE.CapsuleGeometry(0.04, 0.16, 4, 8), ctx.darkMat, -0.3, -0.16, barZ);
    detail(ctx, new THREE.CapsuleGeometry(0.04, 0.16, 4, 8), ctx.darkMat, 0.3, -0.16, barZ);
    // Driver rides in the open bed behind the cab.
    driver(ctx, 0.34, 0.45, 0.2);
    // Side fuel tanks tucked under the bed.
    capsule(ctx, ctx.darkMat, 0.13, 0.4, "z", -(bw * 0.5), -0.28, 0.35);
    capsule(ctx, ctx.darkMat, 0.13, 0.4, "z", bw * 0.5, -0.28, 0.35);
    // Twin exhaust stacks flanking the cab with accent collars.
    for (const sx of [-1, 1]) {
      const x = sx * bw * 0.4;
      volume(ctx, new THREE.CylinderGeometry(0.06, 0.06, 0.55, 10), ctx.darkMat, x, 0.4, 0.05);
      const collar = detail(
        ctx,
        new THREE.TorusGeometry(0.07, 0.022, 8, 12),
        ctx.accentMat,
        x,
        0.64,
        0.05,
      );
      collar.rotation.x = Math.PI / 2;
    }
  },
};
