/**
 * Kart dimensional measurement helpers for the dev garage viewer and
 * regression tests. Two layers: a pure `deriveDimensions` that reads only the
 * silhouette + normalized wheel stance (WebGL-free, jsdom-safe, the tested
 * path) and a best-effort `measureKartBox` that builds the real racing mesh
 * and reads a THREE.Box3 off its BufferGeometry attributes. All numbers are
 * meters in local kart space (origin at the chassis reference, +Z rear).
 */

import * as THREE from "three";
import type { KartColors } from "../Kart";
import { buildKartVisual, disposeKartVisual } from "../kartVisual";
import { modelById, wheelOffsetsFor } from ".";
import type { KartModelDef, KartVariantId } from "./types";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounds from the real mesh; min/max/size in local space. */
export interface KartBounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

/** Derived kart measurements, all meters in local kart space. */
export interface KartDimensions {
  variant: KartVariantId;
  /** Overall length (nose to rear), Z extent. */
  length: number;
  /** Overall width, X extent. */
  width: number;
  /** Overall height, Y extent. */
  height: number;
  /** Axle-to-axle distance, |frontZ - rearZ|. */
  wheelbase: number;
  /** Wheel centre-to-centre track, |maxX - minX|. */
  trackWidth: number;
  /** Chassis origin height above the ground contact plane. */
  rideHeight: number;
  /** Real mesh bounds when the geometry path is available, else null. */
  bounds: KartBounds | null;
}

// Any opaque paint works: geometry (hence bounds) is colorway-independent.
const MEASURE_COLORS: KartColors = { body: 0x808080, accent: 0x808080 };

/**
 * Pure dimensions from the silhouette + stance alone. Uses wheelOffsetsFor to
 * read per-wheel offsets uniformly (every model's stance — whether built via
 * the stance() helper or a named array like GRIP_STANCE — normalizes to the
 * same ReadonlyArray<WheelOffset>), so wheelbase/track come from the offset
 * extremes rather than per-model special cases. Length/width/height are coarse
 * silhouette proportions; measureKart refines them from the mesh when it can.
 */
export function deriveDimensions(model: KartModelDef): KartDimensions {
  const { bodyDims, tireRadius, noseZ, spoilerH } = model.silhouette;
  const [bodyW, bodyH, bodyD] = bodyDims;
  const offsets = wheelOffsetsFor(model.id);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minWheelY = Infinity;
  for (const off of offsets) {
    minX = Math.min(minX, off.x);
    maxX = Math.max(maxX, off.x);
    minZ = Math.min(minZ, off.z);
    maxZ = Math.max(maxZ, off.z);
    minWheelY = Math.min(minWheelY, off.y);
  }

  const wheelbase = Math.abs(maxZ - minZ);
  const trackWidth = Math.abs(maxX - minX);
  // Ground plane sits a tire radius below the lowest wheel centre.
  const rideHeight = Math.abs(minWheelY) + tireRadius;
  // Coarse silhouette proportions (nose to rear body; body vs track width;
  // ground to body crown). The mesh Box3 supersedes these when available.
  const width = Math.max(bodyW, trackWidth);
  const length = bodyD / 2 - noseZ;
  const height = rideHeight + bodyH / 2 + spoilerH;

  return {
    variant: model.id,
    length,
    width,
    height,
    wheelbase,
    trackWidth,
    rideHeight,
    bounds: null,
  };
}

/**
 * Best-effort real-mesh bounds: build the full kart visual into a detached
 * group, read a THREE.Box3 off its geometry, dispose. setFromObject reads
 * BufferGeometry attributes (no GL context), so this runs under node/jsdom;
 * returns null if geometry is unavailable or the box is empty/non-finite.
 */
export function measureKartBox(variant: KartVariantId): THREE.Box3 | null {
  const group = new THREE.Group();
  try {
    buildKartVisual(group, variant, MEASURE_COLORS);
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) {
      return null;
    }
    return box;
  } catch {
    return null;
  } finally {
    disposeKartVisual(group);
  }
}

function boundsFromBox(box: THREE.Box3): KartBounds {
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: size.x, y: size.y, z: size.z },
  };
}

/**
 * Combined measurement: derived dimensions, refined by the real mesh Box3 when
 * that path works. Wheelbase/track/rideHeight stay stance-derived (exact);
 * length/width/height are overwritten with the true mesh extents and `bounds`
 * is attached. Falls back to the pure derivation if the mesh is unavailable.
 */
export function measureKart(variant: KartVariantId): KartDimensions {
  const dims = deriveDimensions(modelById(variant));
  const box = measureKartBox(variant);
  if (!box) return dims;
  const bounds = boundsFromBox(box);
  return {
    ...dims,
    length: bounds.size.z,
    width: bounds.size.x,
    height: bounds.size.y,
    bounds,
  };
}
