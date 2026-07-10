/** Classic go-kart: rounded pebble hull, soft snout, side pods, low spoiler. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { blob, capsule, detail, driver, stance } from "./parts";
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
    // Pebble hull: one soft scaled sphere instead of the old box chassis.
    const hull = blob(ctx, ctx.bodyMat, bw, bh * 1.5, bd * 0.9, 0, -0.05, 0.05);
    hull.receiveShadow = true;
    // Rounded snout reaching toward noseZ, capped by a dark bumper tube.
    capsule(ctx, ctx.bodyMat, 0.24, 0.36, "z", 0, -0.1, ctx.silhouette.noseZ + 0.16);
    const bumper = detail(
      ctx,
      new THREE.CylinderGeometry(0.05, 0.05, 0.72, 10),
      ctx.darkMat,
      0,
      -0.18,
      -1.02,
    );
    bumper.rotation.z = Math.PI / 2;
    // Accent side pods hugging the hull midsection.
    capsule(ctx, ctx.accentMat, 0.13, 0.5, "z", -0.56, -0.14, 0.2);
    capsule(ctx, ctx.accentMat, 0.13, 0.5, "z", 0.56, -0.14, 0.2);
    driver(ctx, 0.25, 0.15);
    // Low rounded spoiler plank on two posts.
    const spoilerH = Math.max(ctx.silhouette.spoilerH, 0.02);
    blob(ctx, ctx.accentMat, 1.05, spoilerH + 0.05, 0.32, 0, 0.24, 0.92);
    detail(ctx, new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), ctx.darkMat, -0.4, 0.1, 0.92);
    detail(ctx, new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), ctx.darkMat, 0.4, 0.1, 0.92);
  },
};
