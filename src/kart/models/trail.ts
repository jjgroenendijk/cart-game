/** Off-roader: raised body, wheel fenders, roof rack + light bar, spare wheel. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

const TRAIL_STANCE = stance(0.68, -0.76, 0.84);

export const trailModel: KartModelDef = {
  id: "trail",
  name: "Trailblazer",
  colorway: "lagoon",
  tuning: {
    ...DEFAULT_TUNING,
    mass: 280,
    maxSpeed: 33,
    engineForce: 9200,
    grip: 9.0,
    suspensionStiffness: 30000,
    suspensionDamping: 3000,
    suspensionTravel: 0.4,
    wheelRadius: 0.42,
  },
  silhouette: { bodyDims: [1.15, 0.5, 1.9], tireRadius: 0.46, noseZ: -1.0, spoilerH: 0.07 },
  stance: TRAIL_STANCE,
  build(ctx) {
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const body = volume(
      ctx,
      new THREE.BoxGeometry(bw, bh, bd),
      ctx.bodyMat,
      0,
      0.02,
      0,
      BODY_OUTLINE,
    );
    body.receiveShadow = true;
    // Fender blades over each wheel (accent) — fed by this model's stance.
    const fenderY = -0.35 + ctx.silhouette.tireRadius + 0.06;
    for (const off of TRAIL_STANCE) {
      volume(ctx, new THREE.BoxGeometry(0.3, 0.07, 0.72), ctx.accentMat, off.x, fenderY, off.z);
    }
    driver(ctx, 0.34, 0.1, 0.2);
    // Roof rack plank + three-lamp light bar on its leading edge.
    volume(ctx, new THREE.BoxGeometry(bw * 0.78, 0.05, 0.9), ctx.darkMat, 0, 0.62, 0.1);
    for (const sx of [-1, 0, 1]) {
      detail(ctx, new THREE.BoxGeometry(0.12, 0.08, 0.08), ctx.accentMat, sx * 0.24, 0.68, -0.3);
    }
    detail(ctx, new THREE.BoxGeometry(0.05, 0.24, 0.05), ctx.darkMat, -(bw * 0.34), 0.5, 0.45);
    detail(ctx, new THREE.BoxGeometry(0.05, 0.24, 0.05), ctx.darkMat, bw * 0.34, 0.5, 0.45);
    // Spare wheel on the tailgate.
    const spare = volume(
      ctx,
      new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14),
      ctx.darkMat,
      0,
      0.12,
      bd * 0.5 + 0.08,
    );
    spare.rotation.x = Math.PI / 2;
  },
};
