/**
 * 083 per-variant chassis models. Each KartVariantId maps to a distinct
 * procedural body builder (cel primitives only — no assets) plus a wheel
 * stance (local wheel offsets). Kart.ts owns the wheel rigs + physics sync;
 * this module owns everything above the axles. Builders take materials from
 * the caller so a colorway repaint never touches geometry. Runs under jsdom
 * (geometry only, no WebGL), so unit tests can assert per-model part counts.
 *
 * LOD convention (matches kartLod): primary volumes get an inverted-hull
 * outline; small garnish is flagged `userData.kartDetail = true` (hidden at
 * distance) and carries no outline of its own.
 */

import * as THREE from "three";
import { addOutline } from "../materials/outline";
import type { KartSilhouette, KartVariantId } from "./kartVariants";

// Screen-space inverted-hull thickness (NDC units; ~thickness * screenWidth/2
// pixels). Kart reads mid-screen, so a few px reads as a crisp toon rim.
export const BODY_OUTLINE = 0.005;
export const DETAIL_OUTLINE = 0.004;

export interface WheelOffset {
  x: number;
  y: number;
  z: number;
}

/**
 * Per-model wheel stance. y stays -0.35 everywhere: Kart.sync's suspension
 * bounce (`-0.35 + compression * 0.5`) hardcodes that base. Order: front-L,
 * front-R, rear-L, rear-R (front pair steers).
 */
const STANCES: Record<KartVariantId, ReadonlyArray<WheelOffset>> = {
  balanced: stance(0.62, -0.78, 0.82),
  speed: stance(0.6, -0.92, 0.88),
  grip: stance(0.72, -0.68, 0.74),
  heavy: stance(0.74, -0.78, 0.86),
  feather: stance(0.55, -0.72, 0.76),
  trail: stance(0.68, -0.76, 0.84),
};

function stance(x: number, frontZ: number, rearZ: number): ReadonlyArray<WheelOffset> {
  return [
    { x: -x, y: -0.35, z: frontZ },
    { x, y: -0.35, z: frontZ },
    { x: -x, y: -0.35, z: rearZ },
    { x, y: -0.35, z: rearZ },
  ];
}

/** Local wheel offsets for a model (shared by the visual rig + VFX contact points). */
export function wheelOffsetsFor(model: KartVariantId): ReadonlyArray<WheelOffset> {
  return STANCES[model];
}

export interface KartBodyCtx {
  group: THREE.Group;
  bodyMat: THREE.Material;
  accentMat: THREE.Material;
  darkMat: THREE.Material;
  silhouette: KartSilhouette;
}

type Builder = (ctx: KartBodyCtx) => void;

/** Add a primary volume: shadowed, outlined, survives LOD reduction. */
function volume(
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
function detail(
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
function driver(ctx: KartBodyCtx, y: number, z: number, headR = 0.22): void {
  const seat = volume(ctx, new THREE.BoxGeometry(0.6, 0.45, 0.6), ctx.darkMat, 0, y, z);
  seat.castShadow = true;
  volume(ctx, new THREE.SphereGeometry(headR, 12, 10), ctx.accentMat, 0, y + 0.3, z);
}

/** Classic go-kart: the pre-083 stock mesh, reproduced part for part. */
const balanced: Builder = (ctx) => {
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
};

/** Formula-style: long slim hull, nose cone, side pods, strutted rear wing. */
const speed: Builder = (ctx) => {
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
};

/** Wide low racer: splitter blade, side skirts, kicked-up ducktail. */
const grip: Builder = (ctx) => {
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
  detail(ctx, new THREE.BoxGeometry(0.08, 0.12, bd * 0.66), ctx.darkMat, -(bw * 0.66), -0.22, 0.05);
  detail(ctx, new THREE.BoxGeometry(0.08, 0.12, bd * 0.66), ctx.darkMat, bw * 0.66, -0.22, 0.05);
  driver(ctx, 0.22, 0.1);
  // Ducktail: short angled accent flap off the rear deck.
  const tail = volume(ctx, new THREE.BoxGeometry(bw, 0.05, 0.3), ctx.accentMat, 0, 0.14, bd * 0.48);
  tail.rotation.x = -0.35;
  detail(ctx, new THREE.BoxGeometry(0.24, 0.1, 0.24), ctx.darkMat, 0, 0.14, 0.62);
};

/** Mini-truck: tall body + cab, bull bar, twin exhaust stacks. */
const heavy: Builder = (ctx) => {
  const [bw, bh, bd] = ctx.silhouette.bodyDims;
  const bed = volume(
    ctx,
    new THREE.BoxGeometry(bw, bh, bd),
    ctx.bodyMat,
    0,
    -0.05,
    0,
    BODY_OUTLINE,
  );
  bed.receiveShadow = true;
  volume(
    ctx,
    new THREE.BoxGeometry(bw * 0.85, 0.42, 0.85),
    ctx.bodyMat,
    0,
    0.28,
    0.3,
    BODY_OUTLINE,
  );
  volume(ctx, new THREE.BoxGeometry(bw * 0.9, 0.06, 0.92), ctx.accentMat, 0, 0.53, 0.3);
  // Bull bar: horizontal dark tube spanning the nose + two posts.
  const bar = volume(
    ctx,
    new THREE.CylinderGeometry(0.06, 0.06, bw * 0.9, 10),
    ctx.darkMat,
    0,
    -0.02,
    ctx.silhouette.noseZ - 0.12,
  );
  bar.rotation.z = Math.PI / 2;
  const postZ = ctx.silhouette.noseZ - 0.12;
  detail(ctx, new THREE.BoxGeometry(0.06, 0.26, 0.06), ctx.darkMat, -0.3, -0.14, postZ);
  detail(ctx, new THREE.BoxGeometry(0.06, 0.26, 0.06), ctx.darkMat, 0.3, -0.14, postZ);
  driver(ctx, 0.36, 0.3, 0.2);
  // Twin exhaust stacks behind the cab with accent tips.
  for (const sx of [-1, 1]) {
    const x = sx * bw * 0.34;
    volume(ctx, new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), ctx.darkMat, x, 0.35, 0.78);
    detail(ctx, new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), ctx.accentMat, x, 0.62, 0.78);
  }
};

/** Open buggy: narrow spine, exposed rails, roll hoop, pennant flag. */
const feather: Builder = (ctx) => {
  const [bw, bh, bd] = ctx.silhouette.bodyDims;
  const spine = volume(
    ctx,
    new THREE.BoxGeometry(bw * 0.55, bh * 0.8, bd),
    ctx.bodyMat,
    0,
    -0.12,
    0,
    BODY_OUTLINE,
  );
  spine.receiveShadow = true;
  volume(
    ctx,
    new THREE.BoxGeometry(0.42, 0.18, 0.4),
    ctx.accentMat,
    0,
    -0.12,
    ctx.silhouette.noseZ,
  );
  // Exposed side rails: the "frame showing" read of the featherweight.
  detail(ctx, new THREE.BoxGeometry(0.05, 0.05, bd * 0.9), ctx.darkMat, -(bw * 0.45), -0.03, 0);
  detail(ctx, new THREE.BoxGeometry(0.05, 0.05, bd * 0.9), ctx.darkMat, bw * 0.45, -0.03, 0);
  driver(ctx, 0.28, 0.15, 0.22);
  // Roll hoop behind the driver: two uprights + a top bar.
  detail(ctx, new THREE.BoxGeometry(0.05, 0.5, 0.05), ctx.darkMat, -0.26, 0.3, 0.5);
  detail(ctx, new THREE.BoxGeometry(0.05, 0.5, 0.05), ctx.darkMat, 0.26, 0.3, 0.5);
  detail(ctx, new THREE.BoxGeometry(0.57, 0.05, 0.05), ctx.darkMat, 0, 0.55, 0.5);
  // Antenna pennant off the left rear corner.
  detail(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), ctx.darkMat, -0.34, 0.55, 0.78);
  detail(ctx, new THREE.BoxGeometry(0.02, 0.12, 0.2), ctx.accentMat, -0.34, 0.84, 0.86);
};

/** Off-roader: raised body, wheel fenders, roof rack + light bar, spare wheel. */
const trail: Builder = (ctx) => {
  const [bw, bh, bd] = ctx.silhouette.bodyDims;
  const body = volume(
    ctx,
    new THREE.BoxGeometry(bw, bh, bd),
    ctx.bodyMat,
    0,
    0.02,
    0,
    BODY_OUTLINE,
  );
  body.receiveShadow = true;
  // Fender blades over each wheel (accent) — fed by this model's stance.
  const fenderY = -0.35 + ctx.silhouette.tireRadius + 0.06;
  for (const off of wheelOffsetsFor("trail")) {
    volume(ctx, new THREE.BoxGeometry(0.3, 0.07, 0.72), ctx.accentMat, off.x, fenderY, off.z);
  }
  driver(ctx, 0.34, 0.1, 0.2);
  // Roof rack plank + three-lamp light bar on its leading edge.
  volume(ctx, new THREE.BoxGeometry(bw * 0.78, 0.05, 0.9), ctx.darkMat, 0, 0.62, 0.1);
  for (const sx of [-1, 0, 1]) {
    detail(ctx, new THREE.BoxGeometry(0.12, 0.08, 0.08), ctx.accentMat, sx * 0.24, 0.68, -0.3);
  }
  detail(ctx, new THREE.BoxGeometry(0.05, 0.24, 0.05), ctx.darkMat, -(bw * 0.34), 0.5, 0.45);
  detail(ctx, new THREE.BoxGeometry(0.05, 0.24, 0.05), ctx.darkMat, bw * 0.34, 0.5, 0.45);
  // Spare wheel on the tailgate.
  const spare = volume(
    ctx,
    new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14),
    ctx.darkMat,
    0,
    0.12,
    bd * 0.5 + 0.08,
  );
  spare.rotation.x = Math.PI / 2;
};

const BUILDERS: Record<KartVariantId, Builder> = {
  balanced,
  speed,
  grip,
  heavy,
  feather,
  trail,
};

/** Build the chassis (everything above the axles) for `model` into ctx.group. */
export function buildKartBody(model: KartVariantId, ctx: KartBodyCtx): void {
  BUILDERS[model](ctx);
}
