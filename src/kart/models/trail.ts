/** Off-roader: tall rounded body, fender arches, roof rack, snorkel, spare. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { blob, detail, driver, stance, volume } from "./parts";
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
    const [bw, , bd] = ctx.silhouette.bodyDims;
    // Tall rounded body riding high over the big wheels.
    const body = blob(ctx, ctx.bodyMat, bw * 1.05, 0.68, bd * 0.92, 0, 0.06, 0);
    body.receiveShadow = true;
    // Accent fender arches over each wheel (fed by this model's stance):
    // half-cylinders whose axis lies along the axle, arching over the tire.
    const archR = ctx.silhouette.tireRadius + 0.1;
    for (const off of TRAIL_STANCE) {
      const arch = volume(
        ctx,
        new THREE.CylinderGeometry(archR, archR, 0.3, 12, 1, false, 0, Math.PI),
        ctx.accentMat,
        off.x,
        -0.32,
        off.z,
      );
      arch.rotation.z = Math.PI / 2;
    }
    driver(ctx, 0.34, 0.1, 0.2);
    // Roof rack plank + three-lamp light bar on its leading edge.
    volume(ctx, new THREE.BoxGeometry(bw * 0.75, 0.05, 0.85), ctx.darkMat, 0, 0.64, 0.1);
    for (const sx of [-1, 0, 1]) {
      detail(ctx, new THREE.SphereGeometry(0.06, 10, 8), ctx.accentMat, sx * 0.22, 0.7, -0.28);
    }
    detail(ctx, new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8), ctx.darkMat, -0.36, 0.52, 0.45);
    detail(ctx, new THREE.CylinderGeometry(0.025, 0.025, 0.24, 8), ctx.darkMat, 0.36, 0.52, 0.45);
    // Snorkel climbing the right A-pillar with a forward-facing elbow.
    detail(ctx, new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), ctx.darkMat, 0.5, 0.32, -0.6);
    const elbow = detail(
      ctx,
      new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8),
      ctx.darkMat,
      0.5,
      0.56,
      -0.67,
    );
    elbow.rotation.x = Math.PI / 2;
    // Spare wheel on the tailgate with an accent hub.
    const spare = volume(
      ctx,
      new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14),
      ctx.darkMat,
      0,
      0.16,
      bd * 0.5 + 0.1,
    );
    spare.rotation.x = Math.PI / 2;
    const hub = detail(
      ctx,
      new THREE.CylinderGeometry(0.1, 0.1, 0.14, 10),
      ctx.accentMat,
      0,
      0.16,
      bd * 0.5 + 0.1,
    );
    hub.rotation.x = Math.PI / 2;
  },
};
