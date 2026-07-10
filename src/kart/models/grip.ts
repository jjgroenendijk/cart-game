/** Wide low racer: splitter blade, side skirts, kicked-up ducktail. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

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
  stance: stance(0.72, -0.68, 0.74),
  build(ctx) {
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const hull = volume(
      ctx,
      new THREE.BoxGeometry(bw * 1.2, bh, bd),
      ctx.bodyMat,
      0,
      -0.08,
      0,
      BODY_OUTLINE,
    );
    hull.receiveShadow = true;
    // Front splitter: a thin accent blade wider than the hull, near the deck.
    volume(
      ctx,
      new THREE.BoxGeometry(bw * 1.45, 0.05, 0.34),
      ctx.accentMat,
      0,
      -0.26,
      ctx.silhouette.noseZ + 0.1,
    );
    detail(
      ctx,
      new THREE.BoxGeometry(0.08, 0.12, bd * 0.66),
      ctx.darkMat,
      -(bw * 0.66),
      -0.22,
      0.05,
    );
    detail(ctx, new THREE.BoxGeometry(0.08, 0.12, bd * 0.66), ctx.darkMat, bw * 0.66, -0.22, 0.05);
    driver(ctx, 0.22, 0.1);
    // Ducktail: short angled accent flap off the rear deck.
    const tail = volume(
      ctx,
      new THREE.BoxGeometry(bw, 0.05, 0.3),
      ctx.accentMat,
      0,
      0.14,
      bd * 0.48,
    );
    tail.rotation.x = -0.35;
    detail(ctx, new THREE.BoxGeometry(0.24, 0.1, 0.24), ctx.darkMat, 0, 0.14, 0.62);
  },
};
