/** Formula rocket: capsule fuselage, cone nose, canopy dome, high rear wing. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { blob, BODY_OUTLINE, capsule, detail, driver, stance, volume } from "./parts";
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
    const [bw, , bd] = ctx.silhouette.bodyDims;
    // Slim capsule fuselage running most of the wheelbase.
    const hull = capsule(ctx, ctx.bodyMat, 0.3, bd * 0.55, "z", 0, -0.06, 0.15, BODY_OUTLINE);
    hull.receiveShadow = true;
    // Needle nose cone reaching past noseZ.
    const cone = volume(
      ctx,
      new THREE.ConeGeometry(0.24, 0.75, 14),
      ctx.bodyMat,
      0,
      -0.08,
      ctx.silhouette.noseZ + 0.1,
      BODY_OUTLINE,
    );
    cone.rotation.x = -Math.PI / 2;
    // Rounded accent side pods hug the fuselage midsection.
    const podX = bw * 0.5;
    capsule(ctx, ctx.accentMat, 0.14, 0.6, "z", -podX, -0.12, 0.25);
    capsule(ctx, ctx.accentMat, 0.14, 0.6, "z", podX, -0.12, 0.25);
    // Dark canopy dome doubles as the windscreen ahead of the cockpit.
    const canopy = volume(
      ctx,
      new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      ctx.darkMat,
      0,
      0.06,
      -0.35,
    );
    canopy.scale.set(1, 0.9, 1.2);
    driver(ctx, 0.16, 0.22, 0.2);
    // High rounded rear wing on two cylinder struts.
    const wingH = Math.max(ctx.silhouette.spoilerH, 0.04);
    blob(ctx, ctx.accentMat, 1.3, wingH + 0.04, 0.34, 0, 0.5, 0.95);
    detail(ctx, new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), ctx.darkMat, -0.38, 0.3, 0.95);
    detail(ctx, new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), ctx.darkMat, 0.38, 0.3, 0.95);
    // Tail exhaust with an accent afterburner ring.
    const pipe = detail(
      ctx,
      new THREE.CylinderGeometry(0.07, 0.09, 0.4, 10),
      ctx.darkMat,
      0,
      0.0,
      1.2,
    );
    pipe.rotation.x = Math.PI / 2;
    detail(ctx, new THREE.TorusGeometry(0.09, 0.022, 8, 14), ctx.accentMat, 0, 0.0, 1.41);
  },
};
