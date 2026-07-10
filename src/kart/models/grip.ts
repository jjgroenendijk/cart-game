/** Wide muscle racer: squashed hull, fender bulges, splitter, ducktail. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { blob, detail, driver, stance } from "./parts";
import type { KartModelDef } from "./types";

const GRIP_STANCE = stance(0.72, -0.68, 0.74);

export const gripModel: KartModelDef = {
  id: "grip",
  name: "Grip",
  colorway: "moss",
  tuning: {
    ...DEFAULT_TUNING,
    maxSpeed: 30,
    engineForce: 10500,
    grip: 11.5,
    driftGrip: 2.0,
    mass: 250,
    maxSteerRate: 2.9,
    brakeForce: 12500,
  },
  silhouette: { bodyDims: [1.05, 0.38, 1.7], tireRadius: 0.34, noseZ: -0.9, spoilerH: 0.03 },
  stance: GRIP_STANCE,
  build(ctx) {
    const [bw, , bd] = ctx.silhouette.bodyDims;
    // Squashed wide hull: low, planted, all curves.
    const hull = blob(ctx, ctx.bodyMat, bw * 1.4, 0.5, bd * 0.95, 0, -0.06, 0);
    hull.receiveShadow = true;
    // Muscle fender bulges swell over each wheel (fed by this model's stance).
    for (const off of GRIP_STANCE) {
      blob(ctx, ctx.bodyMat, 0.38, 0.3, 0.58, off.x, -0.08, off.z);
    }
    // Front splitter: a rounded accent blade wider than the hull, near the deck.
    blob(ctx, ctx.accentMat, bw * 1.5, 0.06, 0.4, 0, -0.24, ctx.silhouette.noseZ + 0.15);
    driver(ctx, 0.2, 0.12);
    // Windscreen dome ahead of the cockpit.
    const screen = detail(
      ctx,
      new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      ctx.darkMat,
      0,
      0.14,
      -0.22,
    );
    screen.scale.set(1.3, 0.8, 1);
    // Ducktail: rounded accent flap kicked up off the rear deck.
    const tail = blob(ctx, ctx.accentMat, bw, 0.06, 0.3, 0, 0.16, bd * 0.44);
    tail.rotation.x = -0.35;
    // Twin exhaust tips under the tail.
    for (const sx of [-1, 1]) {
      const pipe = detail(
        ctx,
        new THREE.CylinderGeometry(0.05, 0.05, 0.24, 8),
        ctx.darkMat,
        sx * 0.32,
        -0.16,
        bd * 0.5,
      );
      pipe.rotation.x = Math.PI / 2;
    }
  },
};
