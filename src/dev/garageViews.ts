/**
 * Pure, WebGL-free camera-framing math for the dev garage viewer
 * (src/dev/Garage.ts). A "view" is a resolved ViewSpec — a named preset
 * (front/side/top/rear ortho, iso/reariso 3/4 perspective) or an arbitrary
 * `az<deg>el<deg>[o]` orbit token — carrying its azimuth/elevation, projection,
 * the real dimension that governs its metric scale, and which overlay dimension
 * set (axis) it draws. Given a spec + measured kart dims this returns plain
 * numbers Garage applies to a THREE camera: the orthographic frustum sized to
 * frame the kart (with a margin) plus the EXACT pixels-per-meter screen scale
 * (canvasHeightPx / frustumHeightMeters), or the perspective orbit params. No
 * THREE, no DOM, so this module is unit-tested under jsdom.
 */

import type { KartDimensions } from "../kart/models/measure";

/** A resolved view id: a preset name or an arbitrary `az..el..` orbit token. */
export type GarageView = string;

/** Real dimension governing a view's metric scale (mirror of RealDims keys). */
export type GovernDim = "length" | "width" | "height";

/** A fully resolved view: orbit angle, projection, metric governing dim, axis. */
export interface ViewSpec {
  /** Normalized token id (e.g. "front", "az30el15"). */
  id: string;
  /** Human/overlay label. */
  label: string;
  /** Orbit azimuth in radians (around +Y from +Z). */
  azimuth: number;
  /** Orbit elevation in radians (above the ground plane). */
  elevation: number;
  /** True for an OrthographicCamera (measurable); false for perspective. */
  ortho: boolean;
  /** Real dimension anchoring the metric compare scale, or null (qualitative). */
  govern: GovernDim | null;
  /** Which overlay dimension set to draw, or null (perspective/arbitrary). */
  axis: "front" | "side" | "top" | null;
}

const DEG = Math.PI / 180;

function preset(
  id: string,
  azDeg: number,
  elDeg: number,
  ortho: boolean,
  govern: GovernDim | null,
  axis: ViewSpec["axis"],
): ViewSpec {
  return { id, label: id, azimuth: azDeg * DEG, elevation: elDeg * DEG, ortho, govern, axis };
}

/**
 * Named view presets — the source of truth for resolution and the panel
 * dropdown. front/side/top/rear are axis-aligned ortho (metric); iso (front
 * 3/4) and reariso (rear 3/4) are perspective (qualitative). rear reuses the
 * front overlay dimension set (width/track/height).
 */
export const VIEW_PRESETS: Record<string, ViewSpec> = {
  front: preset("front", 0, 0, true, "width", "front"),
  side: preset("side", 90, 0, true, "length", "side"),
  top: preset("top", 0, 90, true, "width", "top"),
  rear: preset("rear", 180, 0, true, "width", "front"),
  iso: preset("iso", 35, 25, false, null, null),
  reariso: preset("reariso", 215, 25, false, null, null),
};

/** Default contact-sheet set + back-compat: the canonical 2x2 reference views. */
export const GARAGE_VIEWS: readonly GarageView[] = ["front", "side", "top", "iso"];

/** Presets offered in the panel dropdown, in display order. */
export const PRESET_VIEWS: readonly string[] = ["front", "side", "top", "rear", "iso", "reariso"];

/** Margin factor applied around the kart bounds when framing (1 = tight fit). */
export const FRAME_PAD = 1.2;

/** Metric grid / annotation step in meters, shared by views + overlay. */
export const GRID_STEP = 0.5;

/** Arbitrary orbit token: az<deg>el<deg> with optional `o` suffix for ortho. */
const ARBITRARY = /^az(-?\d+(?:\.\d+)?)el(-?\d+(?:\.\d+)?)(o)?$/i;

/** Clamp arbitrary elevation shy of the poles (top/bottom are preset-only). */
const EL_LIMIT = 89;

/**
 * Resolve an untrusted token (URL/CLI) to a ViewSpec, or null if invalid. A
 * preset name matches first (case-insensitive); otherwise `az<deg>el<deg>[o]`
 * gives an arbitrary orbit (perspective unless the `o` suffix requests ortho),
 * elevation clamped to +/-89deg. Arbitrary angles are never metric.
 */
export function resolveView(token: string | null | undefined): ViewSpec | null {
  if (token == null) return null;
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const named = VIEW_PRESETS[t];
  if (named) return named;
  const m = ARBITRARY.exec(t);
  if (!m) return null;
  const az = Number.parseFloat(m[1]!);
  let el = Number.parseFloat(m[2]!);
  if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
  el = Math.max(-EL_LIMIT, Math.min(EL_LIMIT, el));
  const ortho = m[3] != null;
  return {
    id: t,
    label: `az${az} el${el}${ortho ? " o" : ""}`,
    azimuth: az * DEG,
    elevation: el * DEG,
    ortho,
    govern: null,
    axis: null,
  };
}

/** True when `value` resolves to a usable view (preset or arbitrary orbit). */
export function isGarageView(value: string | null | undefined): boolean {
  return resolveView(value) != null;
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
 * Unit eye-offset direction (center -> camera) for an orbit angle, matching the
 * garage's convention: azimuth around +Y from +Z, elevation above the ground.
 * front (0,0) -> +Z, side (90,0) -> +X, top (0,90) -> +Y.
 */
export function orbitEye(azimuth: number, elevation: number): Size3 {
  const ce = Math.cos(elevation);
  return { x: ce * Math.sin(azimuth), y: Math.sin(elevation), z: ce * Math.cos(azimuth) };
}

/**
 * Camera up vector for an orbit elevation: world +Y normally, but -Z looking
 * straight down (top, el ~ +90) and +Z straight up, so the pole views stay
 * well-defined (matches the legacy top-view up of (0,0,-1)).
 */
export function orbitUp(elevation: number): Size3 {
  if (elevation >= (EL_LIMIT + 0.5) * DEG) return { x: 0, y: 0, z: -1 };
  if (elevation <= -(EL_LIMIT + 0.5) * DEG) return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 1, z: 0 };
}

function cross(a: Size3, b: Size3): Size3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Screen-plane extents (meters) of the kart bounds for an arbitrary orbit,
 * using the same right/up basis THREE derives from position + lookAt + up. For
 * a centered axis-aligned box the span along an axis is the sum of |size_i *
 * axis_i|; front/side/top reproduce planeExtents exactly.
 */
export function projectedExtents(
  azimuth: number,
  elevation: number,
  dims: KartDimensions,
): { w: number; h: number } {
  const s = sizeOf(dims);
  const zc = orbitEye(azimuth, elevation); // camera +Z (toward camera)
  const up = orbitUp(elevation);
  const xc = cross(up, zc); // camera right
  const yc = cross(zc, xc); // camera up
  const span = (axis: Size3): number =>
    Math.abs(s.x * axis.x) + Math.abs(s.y * axis.y) + Math.abs(s.z * axis.z);
  return { w: span(xc), h: span(yc) };
}

/**
 * In-plane extents (screen horizontal `w`, vertical `h`) in meters for a preset
 * view: front sees X/Y, side sees Z/Y, top sees X/Z. iso/rear/arbitrary fall
 * back to a coarse XZ/Y span (only a framing-radius input for perspective).
 */
export function planeExtents(view: GarageView, dims: KartDimensions): { w: number; h: number } {
  const s = sizeOf(dims);
  switch (view) {
    case "front":
    case "rear":
      return { w: s.x, h: s.y };
    case "side":
      return { w: s.z, h: s.y };
    case "top":
      return { w: s.x, h: s.z };
    default:
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
 * Fit a frustum to in-plane extents (`w`x`h` meters) at the viewport aspect
 * with a FRAME_PAD margin. frustumHeight grows so BOTH extents fit, and
 * pixelsPerMeter is the exact vertical map (viewport.h / frustumHeight); the
 * ortho frustum keeps that aspect so the horizontal scale matches exactly.
 */
export function frameExtents(
  w: number,
  h: number,
  viewport: { w: number; h: number },
): OrthoFraming {
  const aspect = viewport.w / viewport.h;
  const frustumHeight = Math.max(h * FRAME_PAD, (w * FRAME_PAD) / aspect);
  const frustumWidth = frustumHeight * aspect;
  return { frustumHeight, frustumWidth, pixelsPerMeter: viewport.h / frustumHeight };
}

/** Frame an axis-aligned ortho preset to the kart bounds (via planeExtents). */
export function orthoFraming(
  view: GarageView,
  dims: KartDimensions,
  viewport: { w: number; h: number },
): OrthoFraming {
  const { w, h } = planeExtents(view, dims);
  return frameExtents(w, h, viewport);
}

/**
 * Ortho frustum framing for any view spec: axis-aligned presets frame from
 * planeExtents (byte-identical to legacy); arbitrary-orbit ortho views project
 * the bounds onto the camera plane via projectedExtents.
 */
export function viewFraming(
  spec: ViewSpec,
  dims: KartDimensions,
  viewport: { w: number; h: number },
): OrthoFraming {
  if (spec.axis) return orthoFraming(spec.id, dims, viewport);
  const pe = projectedExtents(spec.azimuth, spec.elevation, dims);
  return frameExtents(pe.w, pe.h, viewport);
}

/**
 * Ortho camera pose (up + unit eye-offset direction) for a view spec. The
 * axis-aligned presets keep their exact legacy vectors (so front/side/top stay
 * byte-identical — orbitEye would introduce float noise at 90deg); rear mirrors
 * front along +Z; arbitrary orbits derive from orbitEye/orbitUp.
 */
export function orthoPose(spec: ViewSpec): { up: Size3; eye: Size3 } {
  switch (spec.id) {
    case "front":
      return { up: { x: 0, y: 1, z: 0 }, eye: { x: 0, y: 0, z: 1 } };
    case "side":
      return { up: { x: 0, y: 1, z: 0 }, eye: { x: 1, y: 0, z: 0 } };
    case "top":
      return { up: { x: 0, y: 0, z: -1 }, eye: { x: 0, y: 1, z: 0 } };
    case "rear":
      return { up: { x: 0, y: 1, z: 0 }, eye: { x: 0, y: 0, z: -1 } };
    default:
      return { up: orbitUp(spec.elevation), eye: orbitEye(spec.azimuth, spec.elevation) };
  }
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
 * Perspective orbit params framed to the bounds sphere: distance = padded
 * bounds radius / sin(halfFov), so the kart fills the frame regardless of
 * chassis or angle. Defaults to the 3/4 iso angle (azimuth 35deg, elevation
 * 25deg); reariso and arbitrary perspective views pass their own orbit.
 */
export function isoFraming(
  dims: KartDimensions,
  azimuth = 35 * DEG,
  elevation = 25 * DEG,
  fov = 35,
): IsoFraming {
  const s = sizeOf(dims);
  const radius = 0.5 * Math.hypot(s.x, s.y, s.z);
  const halfFov = (fov * DEG) / 2;
  const distance = (radius * FRAME_PAD) / Math.sin(halfFov);
  return { azimuth, elevation, distance, fov };
}
