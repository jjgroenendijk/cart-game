/**
 * Shared part vocabulary for chassis builders (cel primitives only — no
 * assets). Two tiers, matching the kart LOD convention (kartLod): primary
 * `volume`s cast shadows; small `detail` garnish is flagged
 * `userData.kartDetail = true` (hidden at distance). Runs under jsdom
 * (geometry only, no WebGL).
 */

import * as THREE from "three";
import type { KartBodyCtx, WheelOffset } from "./types";

/** Symmetric 4-wheel stance: track half-width x, front/rear axle z. */
export function stance(x: number, frontZ: number, rearZ: number): ReadonlyArray<WheelOffset> {
  return [
    { x: -x, y: -0.35, z: frontZ },
    { x, y: -0.35, z: frontZ },
    { x: -x, y: -0.35, z: rearZ },
    { x, y: -0.35, z: rearZ },
  ];
}

/** Add a primary volume: shadowed, survives LOD reduction. */
export function volume(
  ctx: KartBodyCtx,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  ctx.group.add(mesh);
  return mesh;
}

/** Add garnish: no outline, hidden at LOD distance via kartDetail. */
export function detail(
  ctx: KartBodyCtx,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.userData.kartDetail = true;
  ctx.group.add(mesh);
  return mesh;
}

/**
 * Rounded hull volume: a unit sphere scaled to (w, h, d). The workhorse of
 * the soft painterly silhouettes — bodies, pods, spoiler planks, fender
 * bulges.
 */
export function blob(
  ctx: KartBodyCtx,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = volume(ctx, new THREE.SphereGeometry(0.5, 20, 14), mat, x, y, z);
  mesh.scale.set(w, h, d);
  return mesh;
}

export type Axis = "x" | "y" | "z";

/** Rotate a Y-axis primitive (capsule/cylinder/cone) onto `axis`. */
export function orient(mesh: THREE.Mesh, axis: Axis): THREE.Mesh {
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  else if (axis === "z") mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Rounded tube volume: capsule of radius r, cylindrical length len, along axis. */
export function capsule(
  ctx: KartBodyCtx,
  mat: THREE.Material,
  r: number,
  len: number,
  axis: Axis,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  return orient(volume(ctx, new THREE.CapsuleGeometry(r, len, 6, 14), mat, x, y, z), axis);
}

/**
 * Driver figure shared by every model (position varies): rounded seat back,
 * torso, accent helmet with dark visor, tilted steering wheel. Seat/torso/
 * helmet are volumes; visor + wheel are LOD-hidden garnish.
 */
export function driver(ctx: KartBodyCtx, y: number, z: number, headR = 0.22): void {
  const seat = blob(ctx, ctx.darkMat, 0.56, 0.5, 0.24, 0, y + 0.02, z + 0.3);
  seat.castShadow = true;
  capsule(ctx, ctx.darkMat, 0.17, 0.16, "y", 0, y + 0.02, z);
  volume(ctx, new THREE.SphereGeometry(headR, 14, 12), ctx.accentMat, 0, y + 0.3, z);
  const visor = detail(
    ctx,
    new THREE.SphereGeometry(headR * 0.72, 10, 8),
    ctx.darkMat,
    0,
    y + 0.32,
    z - headR * 0.5,
  );
  visor.scale.set(1, 0.62, 0.7);
  const wheel = detail(
    ctx,
    new THREE.TorusGeometry(0.12, 0.028, 8, 16),
    ctx.darkMat,
    0,
    y + 0.16,
    z - 0.4,
  );
  wheel.rotation.x = -1.1;
}
