/** Classic go-kart: the all-rounder stock kart. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, driver, stance, volume } from "./parts";
import type { KartModelDef } from "./types";

export const balancedModel: KartModelDef = {
  id: "balanced",
  name: "Balanced",
  colorway: "ember",
  tuning: { ...DEFAULT_TUNING },
  silhouette: { bodyDims: [1.1, 0.4, 1.9], tireRadius: 0.35, noseZ: -1.0, spoilerH: 0.06 },
  stance: stance(0.62, -0.78, 0.82),
  build(ctx) {
    const [bw, bh, bd] = ctx.silhouette.bodyDims;
    const chassis = volume(
      ctx,
      new THREE.BoxGeometry(bw, bh, bd),
      ctx.bodyMat,
      0,
      -0.05,
      0,
      BODY_OUTLINE,
    );
    chassis.receiveShadow = true;
    volume(
      ctx,
      new THREE.BoxGeometry(0.9, 0.28, 0.5),
      ctx.bodyMat,
      0,
      -0.1,
      ctx.silhouette.noseZ,
      BODY_OUTLINE,
    );
    driver(ctx, 0.25, 0.15);
    const spoilerH = Math.max(ctx.silhouette.spoilerH, 0.02);
    volume(ctx, new THREE.BoxGeometry(1.1, spoilerH, 0.3), ctx.accentMat, 0, 0.2, 0.95);
    detail(ctx, new THREE.BoxGeometry(0.06, 0.22, 0.2), ctx.darkMat, -0.45, 0.1, 0.95);
    detail(ctx, new THREE.BoxGeometry(0.06, 0.22, 0.2), ctx.darkMat, 0.45, 0.1, 0.95);
  },
};
