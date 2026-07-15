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
import type { KartWheelStyle } from "./models";
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
    const rig = buildWheel(darkMat, accentMat, def.silhouette.tireRadius, def.wheelStyle);
    rig.steer.position.set(off.x, off.y, off.z);
    rig.front = FRONT_WHEELS[i]!;
    group.add(rig.steer);
    rigs.push(rig);
  }
  return rigs;
}

function buildWheel(
  tireMat: THREE.Material,
  hubMat: THREE.Material,
  tireRadius: number,
  style?: KartWheelStyle,
): WheelRig {
  const steer = new THREE.Object3D();
  const spin = new THREE.Object3D();
  steer.add(spin);

  // Default cylinder axle is Y; rotate z=PI/2 to lay axle along X (left-right).
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(tireRadius, tireRadius, style?.width ?? 0.22, 18),
    tireMat,
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  addOutline(tire, DETAIL_OUTLINE);
  spin.add(tire);

  const wheelWidth = style?.width ?? 0.22;
  const hubRadius = tireRadius * (style?.hubRatio ?? 0.4);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubRadius, hubRadius, wheelWidth + 0.08, 12),
    hubMat,
  );
  hub.rotation.z = Math.PI / 2;
  spin.add(hub);

  // Spokes radiate in the wheel plane (Y-Z), thin along the axle (X).
  const spokeCount = style?.spokes ?? 4;
  const spokeLength = style ? tireRadius * style.rimRatio * 1.7 : 0.56;
  const spokeWidth = style ? tireRadius * 0.07 : 0.07;
  const faces = style ? [-1, 1] : [0];
  for (const face of faces) {
    if (style) {
      const faceX = face * (wheelWidth / 2 + 0.016);
      const rimRadius = tireRadius * style.rimRatio;
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(rimRadius, rimRadius, 0.018, 24),
        hubMat,
      );
      rim.position.x = faceX;
      rim.rotation.z = Math.PI / 2;
      rim.userData.kartDetail = true;
      spin.add(rim);
      const inset = new THREE.Mesh(
        new THREE.CylinderGeometry(rimRadius * 0.76, rimRadius * 0.76, 0.021, 20),
        tireMat,
      );
      inset.position.x = face * (wheelWidth / 2 + 0.028);
      inset.rotation.z = Math.PI / 2;
      inset.userData.kartDetail = true;
      spin.add(inset);
    }
    for (let i = 0; i < spokeCount; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.018, spokeLength, spokeWidth), hubMat);
      spoke.position.x = style ? face * (wheelWidth / 2 + 0.04) : 0;
      spoke.rotation.x = (i / spokeCount) * Math.PI * 2;
      spoke.userData.kartDetail = true;
      spin.add(spoke);
    }
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
