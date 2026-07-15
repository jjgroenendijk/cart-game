/** Box-flared rally hatch: closed cabin, pop-up lamps, vents, mirrors, roof wing. */

import * as THREE from "three";
import { DEFAULT_TUNING } from "../KartController";
import { BODY_OUTLINE, detail, stance, volume } from "./parts";
import type { KartBodyCtx, KartModelDef } from "./types";

const RALLY_STANCE = stance(0.72, -0.78, 0.76);

function box(
  ctx: KartBodyCtx,
  mat: THREE.Material,
  dims: [number, number, number],
  pos: [number, number, number],
  outlined = true,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(...dims, 1, 1, 1);
  if (outlined) return volume(ctx, geo, mat, ...pos, BODY_OUTLINE);
  return detail(ctx, geo, mat, ...pos);
}

/** Place a thin dark slat against either side of the rear quarter. */
function sideSlat(ctx: KartBodyCtx, side: number, y: number, z: number): void {
  const slat = box(ctx, ctx.darkMat, [0.035, 0.045, 0.28], [side * 0.716, y, z], false);
  slat.rotation.x = -0.05;
}

/** Thin trapezoid in the Y-Z plane; the front top inset gives the A-pillar its rake. */
function sideWindowGeometry(
  frontZ: number,
  rearZ: number,
  height: number,
  frontInset: number,
): THREE.BufferGeometry {
  const halfT = 0.018;
  const halfH = height / 2;
  const points: [number, number, number][] = [];
  for (const x of [-halfT, halfT]) {
    points.push(
      [x, -halfH, frontZ],
      [x, halfH, frontZ + frontInset],
      [x, halfH, rearZ],
      [x, -halfH, rearZ],
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points.flat()), 3));
  geo.setIndex([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  geo.computeVertexNormals();
  return geo;
}

export const rallyModel: KartModelDef = {
  id: "rally",
  name: "Rally Hatch",
  colorway: "rally",
  tuning: {
    ...DEFAULT_TUNING,
    mass: 255,
    engineForce: 9800,
    maxSpeed: 36,
    grip: 10.4,
    driftGrip: 1.75,
    maxSteerRate: 2.7,
    driftBoost: 1.15,
  },
  silhouette: {
    bodyDims: [1.42, 0.48, 2.08],
    tireRadius: 0.38,
    noseZ: -1.08,
    spoilerH: 0.08,
  },
  stance: RALLY_STANCE,
  wheelStyle: { spokes: 10, width: 0.28, hubRatio: 0.2, rimRatio: 0.68 },
  build(ctx) {
    // Low, straight-edged lower shell and stepped hood establish the 1980s hatch profile.
    const shell = box(ctx, ctx.bodyMat, [1.4, 0.48, 2.05], [0, -0.02, 0]);
    shell.receiveShadow = true;
    box(ctx, ctx.bodyMat, [1.31, 0.18, 0.88], [0, 0.26, -0.62]);

    // Closed cabin: red volume beneath inset glazing leaves thick red pillars around each pane.
    box(ctx, ctx.bodyMat, [1.18, 0.64, 1.02], [0, 0.46, 0.22]);
    const windshield = box(ctx, ctx.darkMat, [1.08, 0.46, 0.035], [0, 0.47, -0.3], false);
    windshield.rotation.x = -0.16;
    box(ctx, ctx.darkMat, [0.94, 0.38, 0.035], [0, 0.48, 0.735], false);
    box(ctx, ctx.bodyMat, [1.2, 0.1, 1.05], [0, 0.81, 0.2]);

    for (const side of [-1, 1]) {
      detail(ctx, sideWindowGeometry(-0.25, 0.16, 0.4, 0.12), ctx.darkMat, side * 0.596, 0.48, 0);
      detail(ctx, sideWindowGeometry(0.22, 0.61, 0.4, 0.03), ctx.darkMat, side * 0.596, 0.48, 0);
      // Broad lower sill and squared wheel-arch shoulders.
      box(ctx, ctx.bodyMat, [0.13, 0.14, 1.58], [side * 0.69, -0.25, 0.04]);
      for (const off of RALLY_STANCE.filter((wheel) => Math.sign(wheel.x) === side)) {
        const flare = volume(
          ctx,
          new THREE.CylinderGeometry(0.49, 0.49, 0.2, 12, 1, false, 0, Math.PI),
          ctx.bodyMat,
          off.x,
          -0.26,
          off.z,
        );
        flare.rotation.z = Math.PI / 2;
      }
      // Box mirrors, door handles, and twin banks of rear-quarter intake slats.
      box(ctx, ctx.darkMat, [0.22, 0.16, 0.18], [side * 0.73, 0.42, -0.28], false);
      box(ctx, ctx.darkMat, [0.035, 0.07, 0.15], [side * 0.718, 0.35, 0.31], false);
      for (let i = 0; i < 4; i++) sideSlat(ctx, side, 0.18 - i * 0.055, 0.49);
      for (let i = 0; i < 3; i++) sideSlat(ctx, side, -0.08 - i * 0.055, 0.49);
    }

    // Raised rectangular lamps, full-width grille, and deep slotted rally bumper.
    for (const side of [-1, 1]) {
      const housing = box(ctx, ctx.bodyMat, [0.34, 0.32, 0.2], [side * 0.43, 0.38, -0.9]);
      housing.rotation.x = -0.08;
      const lamp = box(ctx, ctx.accentMat, [0.27, 0.23, 0.035], [side * 0.43, 0.38, -1.01], false);
      lamp.rotation.x = -0.08;
      box(ctx, ctx.accentMat, [0.22, 0.11, 0.05], [side * 0.45, -0.3, -1.1], false);
    }
    box(ctx, ctx.darkMat, [0.74, 0.15, 0.055], [0, 0.01, -1.07], false);
    box(ctx, ctx.bodyMat, [1.5, 0.18, 0.18], [0, -0.24, -1.05]);
    box(ctx, ctx.darkMat, [1.04, 0.12, 0.055], [0, -0.25, -1.15], false);
    for (const x of [-0.34, 0, 0.34]) {
      box(ctx, ctx.bodyMat, [0.08, 0.15, 0.08], [x, -0.25, -1.18], false);
    }
    box(ctx, ctx.bodyMat, [1.46, 0.08, 0.3], [0, -0.39, -1.03]);

    // Hood louvre, twin wipers, and the dark roof spoiler match the reference's black trim.
    box(ctx, ctx.darkMat, [0.48, 0.035, 0.18], [0, 0.37, -0.62], false);
    for (const side of [-1, 1]) {
      const wiper = box(ctx, ctx.darkMat, [0.36, 0.025, 0.035], [side * 0.2, 0.31, -0.34], false);
      wiper.rotation.z = side * 0.12;
      wiper.rotation.x = -0.16;
    }
    box(ctx, ctx.darkMat, [1.28, 0.08, 0.24], [0, 0.87, 0.67]);
    box(ctx, ctx.darkMat, [1.02, 0.1, 0.05], [0, -0.2, 1.04], false);
  },
};
