/** Formula-style speedster: long slim hull, nose cone, strutted rear wing. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

export const speedModel: KartModelDef = {
  id: "speed",
  name: "Speedster",
  colorway: "glacier",
  tuning: {
    ...DEFAULT_TUNING,
    maxSpeed: 39,
    engineForce: 8200,
    grip: 8.5,
    mass: 270,
    maxSteerRate: 2.4,
    topSpeedSteerFactor: 0.6,
    driftBoost: 1.14,
  },
  silhouette: { bodyDims: [1.1, 0.42, 2.1], tireRadius: 0.35, noseZ: -1.15, spoilerH: 0.14 },
  stance: stance(0.6, -0.92, 0.88),
  build(ctx) {
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const hull = volume(
      ctx,
      new THREE.BoxGeometry(bw * 0.82, bh * 0.75, bd),
      ctx.bodyMat,
      0,
      -0.08,
      0,
      BODY_OUTLINE,
    );
    hull.receiveShadow = true;
    const cone = volume(
      ctx,
      new THREE.ConeGeometry(0.3, 0.75, 12),
      ctx.bodyMat,
      0,
      -0.1,
      ctx.silhouette.noseZ - 0.2,
      BODY_OUTLINE,
    );
    cone.rotation.x = -Math.PI / 2;
    // Side pods hug the hull midsection (accent radiator intakes).
    const podX = bw * 0.41 + 0.15;
    volume(ctx, new THREE.BoxGeometry(0.3, 0.22, 0.9), ctx.accentMat, -podX, -0.12, 0.15);
    volume(ctx, new THREE.BoxGeometry(0.3, 0.22, 0.9), ctx.accentMat, podX, -0.12, 0.15);
    // Windscreen wedge ahead of the cockpit.
    detail(ctx, new THREE.BoxGeometry(0.42, 0.16, 0.2), ctx.darkMat, 0, 0.16, -0.35);
    driver(ctx, 0.18, 0.2, 0.2);
    // High rear wing on two struts; spoilerH drives the plank thickness.
    const wingH = Math.max(ctx.silhouette.spoilerH, 0.04);
    volume(ctx, new THREE.BoxGeometry(1.25, wingH, 0.34), ctx.accentMat, 0, 0.46, 0.95);
    detail(ctx, new THREE.BoxGeometry(0.05, 0.34, 0.06), ctx.darkMat, -0.4, 0.26, 0.95);
    detail(ctx, new THREE.BoxGeometry(0.05, 0.34, 0.06), ctx.darkMat, 0.4, 0.26, 0.95);
  },
};
