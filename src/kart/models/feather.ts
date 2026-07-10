/** Open buggy: narrow spine, exposed rails, roll hoop, pennant flag. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
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
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const spine = volume(
      ctx,
      new THREE.BoxGeometry(bw * 0.55, bh * 0.8, bd),
      ctx.bodyMat,
      0,
      -0.12,
      0,
      BODY_OUTLINE,
    );
    spine.receiveShadow = true;
    volume(
      ctx,
      new THREE.BoxGeometry(0.42, 0.18, 0.4),
      ctx.accentMat,
      0,
      -0.12,
      ctx.silhouette.noseZ,
    );
    // Exposed side rails: the "frame showing" read of the featherweight.
    detail(ctx, new THREE.BoxGeometry(0.05, 0.05, bd * 0.9), ctx.darkMat, -(bw * 0.45), -0.03, 0);
    detail(ctx, new THREE.BoxGeometry(0.05, 0.05, bd * 0.9), ctx.darkMat, bw * 0.45, -0.03, 0);
    driver(ctx, 0.28, 0.15, 0.22);
    // Roll hoop behind the driver: two uprights + a top bar.
    detail(ctx, new THREE.BoxGeometry(0.05, 0.5, 0.05), ctx.darkMat, -0.26, 0.3, 0.5);
    detail(ctx, new THREE.BoxGeometry(0.05, 0.5, 0.05), ctx.darkMat, 0.26, 0.3, 0.5);
    detail(ctx, new THREE.BoxGeometry(0.57, 0.05, 0.05), ctx.darkMat, 0, 0.55, 0.5);
    // Antenna pennant off the left rear corner.
    detail(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), ctx.darkMat, -0.34, 0.55, 0.78);
    detail(ctx, new THREE.BoxGeometry(0.02, 0.12, 0.2), ctx.accentMat, -0.34, 0.84, 0.86);
  },
};
