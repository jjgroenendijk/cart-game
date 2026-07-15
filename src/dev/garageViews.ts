/**
 * Pure, WebGL-free camera-framing math for the dev garage viewer
 * (src/dev/Garage.ts). Given a named view + measured kart dimensions it returns
 * plain numbers Garage applies to a THREE camera: the orthographic frustum
 * sized to frame the kart (with a margin) plus the EXACT pixels-per-meter screen
 * scale (canvasHeightPx / frustumHeightMeters), or the 3/4 iso perspective
 * params. No THREE, no DOM, so this module is unit-tested under jsdom.
 */

import type { KartDimensions } from "../kart/models/measure";

export type GarageView = "front" | "side" | "top" | "iso";

/** All views in panel/select order (ortho trio first, orbitable iso last). */
export const GARAGE_VIEWS: readonly GarageView[] = ["front", "side", "top", "iso"];

/** Margin factor applied around the kart bounds when framing (1 = tight fit). */
export const FRAME_PAD = 1.2;

/** Metric grid / annotation step in meters, shared by views + overlay. */
export const GRID_STEP = 0.5;

/** Narrow an untrusted string (e.g. a URL param) to a GarageView. */
export function isGarageView(value: string | null | undefined): value is GarageView {
  return value != null && (GARAGE_VIEWS as readonly string[]).includes(value);
}

interface Size3 {
  x: number;
  y: number;
  z: number;
}

/** Kart bounds size in meters: real mesh bounds when present, else silhouette. */
function sizeOf(dims: KartDimensions): Size3 {
  if (dims.bounds) return dims.bounds.size;
  return { x: dims.width, y: dims.height, z: dims.length };
}

/**
 * Kart bounds center in local kart space: real mesh center when present, else a
 * silhouette estimate. The garage aims the camera here so the kart's bounding
 * box projects symmetric about the screen center (making overlay math trivial).
 */
export function boundsCenter(dims: KartDimensions): Size3 {
  if (dims.bounds) {
    const { min, max } = dims.bounds;
    return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  }
  return { x: 0, y: dims.height / 2 - dims.rideHeight, z: 0 };
}

/**
 * In-plane extents (screen horizontal `w`, vertical `h`) in meters for a view:
 * front sees X/Y, side sees Z/Y, top sees X/Z. iso returns a coarse XZ/Y span
 * (only used as a framing radius input; iso draws no 2D overlay).
 */
export function planeExtents(view: GarageView, dims: KartDimensions): { w: number; h: number } {
  const s = sizeOf(dims);
  switch (view) {
    case "front":
      return { w: s.x, h: s.y };
    case "side":
      return { w: s.z, h: s.y };
    case "top":
      return { w: s.x, h: s.z };
    case "iso":
      return { w: Math.max(s.x, s.z), h: s.y };
  }
}

export interface OrthoFraming {
  /** Vertical frustum extent in meters after fit + FRAME_PAD margin. */
  frustumHeight: number;
  /** Horizontal frustum extent in meters (frustumHeight * viewport aspect). */
  frustumWidth: number;
  /** Exact screen scale: viewport.h / frustumHeight (uniform on both axes). */
  pixelsPerMeter: number;
}

/**
 * Frame an axis-aligned ortho view to the kart bounds with a FRAME_PAD margin.
 * frustumHeight grows so BOTH in-plane extents fit at the viewport aspect, and
 * pixelsPerMeter is the exact vertical map (viewport.h / frustumHeight); because
 * the ortho frustum keeps that aspect the horizontal scale matches it exactly.
 */
export function orthoFraming(
  view: GarageView,
  dims: KartDimensions,
  viewport: { w: number; h: number },
): OrthoFraming {
  const { w: planeW, h: planeH } = planeExtents(view, dims);
  const aspect = viewport.w / viewport.h;
  const frustumHeight = Math.max(planeH * FRAME_PAD, (planeW * FRAME_PAD) / aspect);
  const frustumWidth = frustumHeight * aspect;
  return { frustumHeight, frustumWidth, pixelsPerMeter: viewport.h / frustumHeight };
}

export interface IsoFraming {
  /** Orbit azimuth in radians (around +Y from +Z). */
  azimuth: number;
  /** Orbit elevation in radians (above the ground plane). */
  elevation: number;
  /** Camera distance from the bounds center in meters. */
  distance: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

/**
 * 3/4 perspective params (azimuth 35deg, elevation 25deg) framed to the bounds
 * sphere: distance = padded bounds radius / sin(halfFov), so the kart fills the
 * frame regardless of chassis. Garage turns these into a camera position.
 */
export function isoFraming(dims: KartDimensions, fov = 35): IsoFraming {
  const s = sizeOf(dims);
  const radius = 0.5 * Math.hypot(s.x, s.y, s.z);
  const halfFov = (fov * Math.PI) / 180 / 2;
  const distance = (radius * FRAME_PAD) / Math.sin(halfFov);
  return { azimuth: (35 * Math.PI) / 180, elevation: (25 * Math.PI) / 180, distance, fov };
}
