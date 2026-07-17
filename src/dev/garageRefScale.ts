/**
 * Pure alignment/scale contract for the garage compare mode: place a reference
 * silhouette into the model's pixel grid so the two contours can be diffed.
 *
 * The model render already maps meters -> pixels at an exact, deterministic
 * scale (orthoFraming().pixelsPerMeter) with the kart centered. For the metric
 * ortho views we scale the reference so ONE governing real dimension matches the
 * model at true scale (front -> width, side -> length, top -> width — each the
 * horizontal extent of that view); the perpendicular axis is left free, so a
 * too-tall / too-short model surfaces as a diff band. front/side align to the
 * ground line (silhouette bottoms); top centers (a plan view has no ground). iso
 * has no exact px/m, so it is a proportional bbox-fit only (metric:false) and is
 * qualitative. No DOM/canvas — unit-tested under jsdom.
 */

import type { Mask, MaskBounds } from "./garageMask";
import type { GarageView } from "./garageViews";

/** Real-world car dimensions in meters (agent web-searched); any may be absent. */
export interface RealDims {
  length?: number;
  width?: number;
  height?: number;
}

/** Default governing real dimension per view (the view's horizontal extent). */
const GOVERNING: Record<GarageView, keyof RealDims | null> = {
  front: "width",
  side: "length",
  top: "width",
  iso: null,
};

/**
 * The real-world meters spanning a view's governing (horizontal) axis, or null
 * when unavailable / not metric (iso, or a missing dimension). `override` lets a
 * caller remap a view (e.g. a top image drawn nose-sideways -> `top: "length"`).
 */
export function refGoverningMeters(
  view: GarageView,
  real: RealDims,
  override?: Partial<Record<GarageView, keyof RealDims>>,
): number | null {
  const key = override?.[view] ?? GOVERNING[view];
  if (!key) return null;
  const meters = real[key];
  return meters != null && meters > 0 ? meters : null;
}

/** Affine map from reference-mask pixels to model-mask pixels: p' = p*scale + d. */
export interface Placement {
  scale: number;
  dx: number;
  dy: number;
  /** True when scale is metric (true-to-scale); false for iso proportional fit. */
  metric: boolean;
}

const IDENTITY: Placement = { scale: 1, dx: 0, dy: 0, metric: false };

function spanX(b: MaskBounds): number {
  return b.maxX - b.minX + 1;
}
function spanY(b: MaskBounds): number {
  return b.maxY - b.minY + 1;
}
function centerX(b: MaskBounds): number {
  return (b.minX + b.maxX + 1) / 2;
}
function centerY(b: MaskBounds): number {
  return (b.minY + b.maxY + 1) / 2;
}

/**
 * Compute the placement mapping the reference bbox into the model bbox. Metric
 * views (modelPpm + governMeters present, not iso) scale so the ref's horizontal
 * span equals `governMeters * modelPpm` model pixels; iso (or missing data)
 * fits the ref bbox inside the model bbox uniformly. Horizontal is always
 * centered; vertical is ground-aligned for front/side, centered for top/iso.
 */
export function refPlacement(
  view: GarageView,
  refBounds: MaskBounds,
  modelBounds: MaskBounds,
  modelPpm: number | null,
  governMeters: number | null,
): Placement {
  if (refBounds.empty || modelBounds.empty) return { ...IDENTITY };

  const metric = view !== "iso" && modelPpm != null && modelPpm > 0 && governMeters != null;
  let scale: number;
  if (metric) {
    scale = (governMeters! * modelPpm!) / spanX(refBounds);
  } else {
    scale = Math.min(spanX(modelBounds) / spanX(refBounds), spanY(modelBounds) / spanY(refBounds));
  }

  const dx = centerX(modelBounds) - centerX(refBounds) * scale;
  const groundAligned = view === "front" || view === "side";
  const dy = groundAligned
    ? modelBounds.maxY + 1 - (refBounds.maxY + 1) * scale
    : centerY(modelBounds) - centerY(refBounds) * scale;
  return { scale, dx, dy, metric };
}

/**
 * Nearest-neighbor resample of `src` through `p` into an `outW`x`outH` grid
 * (the model viewport size), by inverse-mapping each output pixel back to the
 * source. Output pixels that fall outside `src` stay 0.
 */
export function resampleMask(src: Mask, p: Placement, outW: number, outH: number): Mask {
  const data = new Uint8Array(outW * outH);
  if (p.scale <= 0) return { data, w: outW, h: outH };
  for (let my = 0; my < outH; my++) {
    const ry = Math.floor((my - p.dy) / p.scale);
    if (ry < 0 || ry >= src.h) continue;
    for (let mx = 0; mx < outW; mx++) {
      const rx = Math.floor((mx - p.dx) / p.scale);
      if (rx < 0 || rx >= src.w) continue;
      if (src.data[ry * src.w + rx]) data[my * outW + mx] = 1;
    }
  }
  return { data, w: outW, h: outH };
}
