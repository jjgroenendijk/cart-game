/** Open dune bug: capsule spine, tube frame, torus roll hoop, pennant flag. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, capsule, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

export const featherModel: KartModelDef = {
  id: "feather",
  name: "Feather",
  colorway: "amber",
  tuning: {
    ...DEFAULT_TUNING,
    mass: 200,
    maxSpeed: 33,
    engineForce: 8800,
    grip: 8.8,
    driftGrip: 1.3,
    maxSteerRate: 3.0,
    driftBoost: 1.18,
    uprightTorque: 22,
  },
  silhouette: { bodyDims: [0.95, 0.38, 1.8], tireRadius: 0.3, noseZ: -0.95, spoilerH: 0.05 },
  stance: stance(0.55, -0.72, 0.76),
  build(ctx) {
    const [bw, , bd] = ctx.silhouette.bodyDims;
    // Slender capsule spine — the whole body is one soft tube.
    const spine = capsule(ctx, ctx.bodyMat, 0.16, bd * 0.6, "z", 0, -0.14, -0.05, BODY_OUTLINE);
    spine.receiveShadow = true;
    // Accent nose ball + rear tail ball bookend the spine.
    volume(ctx, new THREE.SphereGeometry(0.19, 14, 10), ctx.accentMat, 0, -0.12, -0.82);
    volume(ctx, new THREE.SphereGeometry(0.15, 12, 10), ctx.bodyMat, 0, -0.1, 0.78);
    // Exposed tube frame: side rails + two cross members.
    for (const sx of [-1, 1]) {
      const rail = detail(
        ctx,
        new THREE.CylinderGeometry(0.028, 0.028, bd * 0.85, 8),
        ctx.darkMat,
        sx * bw * 0.44,
        -0.05,
        0,
      );
      rail.rotation.x = Math.PI / 2;
    }
    for (const cz of [-0.55, 0.5]) {
      const cross = detail(
        ctx,
        new THREE.CylinderGeometry(0.025, 0.025, bw * 0.85, 8),
        ctx.darkMat,
        0,
        -0.05,
        cz,
      );
      cross.rotation.z = Math.PI / 2;
    }
    driver(ctx, 0.26, 0.12, 0.22);
    // Roll hoop behind the driver: a single dark half-torus.
    volume(ctx, new THREE.TorusGeometry(0.3, 0.035, 8, 16, Math.PI), ctx.darkMat, 0, 0.28, 0.48);
    // Antenna pennant off the left rear corner.
    detail(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), ctx.darkMat, -0.34, 0.55, 0.75);
    detail(ctx, new THREE.BoxGeometry(0.02, 0.12, 0.2), ctx.accentMat, -0.34, 0.86, 0.83);
  },
};
