/**
 * Shared part vocabulary for chassis builders (cel primitives only — no
 * assets). Two tiers, matching the kart LOD convention (kartLod): primary
 * `volume`s get an inverted-hull outline and cast shadows; small `detail`
 * garnish is flagged `userData.kartDetail = true` (hidden at distance) and
 * carries no outline of its own. Runs under jsdom (geometry only, no WebGL).
 */

import * as THREE from "three";
import { addOutline } from "../../materials/outline";
import type { KartBodyCtx, WheelOffset } from "./types";

// Screen-space inverted-hull thickness (NDC units; ~thickness * screenWidth/2
// pixels). Kart reads mid-screen, so a few px reads as a crisp toon rim.
export const BODY_OUTLINE = 0.005;
export const DETAIL_OUTLINE = 0.004;

/** Symmetric 4-wheel stance: track half-width x, front/rear axle z. */
export function stance(x: number, frontZ: number, rearZ: number): ReadonlyArray<WheelOffset> {
  return [
    { x: -x, y: -0.35, z: frontZ },
    { x, y: -0.35, z: frontZ },
    { x: -x, y: -0.35, z: rearZ },
    { x, y: -0.35, z: rearZ },
  ];
}

/** Add a primary volume: shadowed, outlined, survives LOD reduction. */
export function volume(
  ctx: KartBodyCtx,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  outline = DETAIL_OUTLINE,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  addOutline(mesh, outline);
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

/** Seat block + driver head shared by every model (position varies). */
export function driver(ctx: KartBodyCtx, y: number, z: number, headR = 0.22): void {
  const seat = volume(ctx, new THREE.BoxGeometry(0.6, 0.45, 0.6), ctx.darkMat, 0, y, z);
  seat.castShadow = true;
  volume(ctx, new THREE.SphereGeometry(headR, 12, 10), ctx.accentMat, 0, y + 0.3, z);
}
