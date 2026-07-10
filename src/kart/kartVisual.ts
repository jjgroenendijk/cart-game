/**
 * Complete kart visual (chassis + wheel rigs) built from the model registry.
 * Shared by Kart (physics-driven rig) and the select-overlay preview, so the
 * preview shows exactly the mesh that races. Materials are created here from
 * the colorway colors; disposeKartVisual frees them with the geometries.
 */

import * as THREE from "three";
import { makeCel } from "../materials/cel";
import { addOutline, removeOutline } from "../materials/outline";
import { buildKartBody, DETAIL_OUTLINE, modelById, wheelOffsetsFor } from "./models";
import type { KartVariantId } from "./models";
import type { KartColors } from "./Kart";

export interface WheelRig {
  steer: THREE.Object3D;
  spin: THREE.Object3D;
  front: boolean;
}

const FRONT_WHEELS = [true, true, false, false] as const;

/**
 * Build the full kart mesh for `model` painted in `colors` into `group`.
 * Returns the wheel rigs (order matches wheelOffsetsFor) so Kart.sync can
 * drive steer/spin/suspension; the preview ignores them.
 */
export function buildKartVisual(
  group: THREE.Group,
  model: KartVariantId,
  colors: KartColors,
): WheelRig[] {
  const def = modelById(model);
  const bodyMat = makeCel({ color: colors.body });
  const accentMat = makeCel({ color: colors.accent });
  const darkMat = makeCel({ color: 0x1a1a1f });

  buildKartBody(model, { group, bodyMat, accentMat, darkMat, silhouette: def.silhouette });

  const rigs: WheelRig[] = [];
  const offsets = wheelOffsetsFor(model);
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i]!;
    const rig = buildWheel(darkMat, accentMat, def.silhouette.tireRadius);
    rig.steer.position.set(off.x, off.y, off.z);
    rig.front = FRONT_WHEELS[i]!;
    group.add(rig.steer);
    rigs.push(rig);
  }
  return rigs;
}

function buildWheel(tireMat: THREE.Material, hubMat: THREE.Material, tireRadius: number): WheelRig {
  const steer = new THREE.Object3D();
  const spin = new THREE.Object3D();
  steer.add(spin);

  // Default cylinder axle is Y; rotate z=PI/2 to lay axle along X (left-right).
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(tireRadius, tireRadius, 0.22, 18),
    tireMat,
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  addOutline(tire, DETAIL_OUTLINE);
  spin.add(tire);

  const hubRadius = tireRadius * 0.4;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubRadius, hubRadius, 0.24, 12), hubMat);
  hub.rotation.z = Math.PI / 2;
  spin.add(hub);

  // Spokes radiate in the wheel plane (Y-Z), thin along the axle (X).
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.56, 0.07), hubMat);
    spoke.rotation.x = (i / 4) * Math.PI * 2;
    spoke.userData.kartDetail = true;
    spin.add(spoke);
  }

  return { steer, spin, front: true };
}

/**
 * Free GL resources under `group`: detach every inverted-hull outline
 * (disposes its unique InvertedHullMaterial) and dispose the unique
 * geometries + materials across the chassis/wheels. Idempotent.
 */
export function disposeKartVisual(group: THREE.Group): void {
  const outlines: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.outlineHull) outlines.push(mesh);
  });
  for (const o of outlines) removeOutline(o);
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.outlineHull) return;
    if (mesh.geometry) geos.add(mesh.geometry);
    const m = mesh.material;
    if (Array.isArray(m)) for (const mm of m) mats.add(mm);
    else if (m) mats.add(m);
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}
