/**
 * Pure, WebGL-free builder for the garage dimension overlay (src/dev/Garage.ts).
 * Given a view + measured dims + the exact pixels-per-meter + viewport, it emits
 * overlay primitives (grid lines, labeled dimension lines with end caps, a 1 m
 * scale bar) in PIXEL coordinates; Garage renders them as crisp SVG. The kart is
 * framed centered, so every metric maps to `center ± value/2 * pixelsPerMeter`.
 * The iso (perspective) view returns nothing — it relies on the 3D grid + box
 * helper + DOM panel instead. No THREE, no DOM, so this is jsdom-tested.
 */

import type { KartDimensions } from "../kart/models/measure";
import { formatMeters } from "./garageMeasure";
import { GRID_STEP, type GarageView, planeExtents, resolveView } from "./garageViews";

export type OverlayRole = "grid" | "dim" | "cap" | "scale";

export interface OverlayLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: OverlayRole;
}

export interface OverlayLabel {
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
}

export interface OverlayScene {
  view: GarageView;
  lines: OverlayLine[];
  labels: OverlayLabel[];
}

const DIM_GAP = 26; // px from the projected bbox edge to the first dimension line
const DIM_STEP = 22; // px between stacked parallel dimension lines
const CAP = 6; // px half-length of a dimension-line end cap
const LABEL_OFF = 14; // px label offset off its line
const SCALE_MARGIN = 18; // px inset of the scale bar from the bottom-left corner
const GRID_MIN_PX = 8; // skip the grid when a 0.5 m cell is smaller than this

interface Viewport {
  w: number;
  h: number;
}

function addGrid(lines: OverlayLine[], cx: number, cy: number, ppm: number, vp: Viewport): void {
  const stepPx = GRID_STEP * ppm;
  if (stepPx < GRID_MIN_PX) return;
  for (let x = cx; x <= vp.w + 0.5; x += stepPx)
    lines.push({ x1: x, y1: 0, x2: x, y2: vp.h, role: "grid" });
  for (let x = cx - stepPx; x >= -0.5; x -= stepPx)
    lines.push({ x1: x, y1: 0, x2: x, y2: vp.h, role: "grid" });
  for (let y = cy; y <= vp.h + 0.5; y += stepPx)
    lines.push({ x1: 0, y1: y, x2: vp.w, y2: y, role: "grid" });
  for (let y = cy - stepPx; y >= -0.5; y -= stepPx)
    lines.push({ x1: 0, y1: y, x2: vp.w, y2: y, role: "grid" });
}

function addScaleBar(
  lines: OverlayLine[],
  labels: OverlayLabel[],
  ppm: number,
  vp: Viewport,
): void {
  const y = vp.h - SCALE_MARGIN;
  const x0 = SCALE_MARGIN;
  const x1 = x0 + ppm; // 1 m
  lines.push({ x1: x0, y1: y, x2: x1, y2: y, role: "scale" });
  lines.push({ x1: x0, y1: y - CAP, x2: x0, y2: y + CAP, role: "scale" });
  lines.push({ x1, y1: y - CAP, x2: x1, y2: y + CAP, role: "scale" });
  labels.push({ x: x0, y: y - 8, text: "1 m", anchor: "start" });
}

/**
 * Overlay primitives for a view. Axis-aligned ortho views (front/side/top/rear)
 * draw a metric grid, a 1 m scale bar, and labeled dimension lines with end
 * caps for the two in-plane extents plus the relevant axle metric; all are
 * centered on the screen because the kart is framed centered. Perspective and
 * arbitrary-orbit views (axis null) return empty arrays.
 */
export function buildOverlay(
  view: GarageView,
  dims: KartDimensions,
  pixelsPerMeter: number,
  vp: Viewport,
): OverlayScene {
  const lines: OverlayLine[] = [];
  const labels: OverlayLabel[] = [];
  const axis = resolveView(view)?.axis ?? null;
  if (axis == null || pixelsPerMeter <= 0) return { view, lines, labels };

  const ppm = pixelsPerMeter;
  const cx = vp.w / 2;
  const cy = vp.h / 2;
  addGrid(lines, cx, cy, ppm, vp);

  const plane = planeExtents(view, dims);
  const bottom = cy + (plane.h / 2) * ppm;
  const left = cx - (plane.w / 2) * ppm;
  const right = cx + (plane.w / 2) * ppm;

  // Horizontal dimension line (centered on cx) with caps + a label below it.
  const hDim = (y: number, meters: number, text: string): void => {
    const span = meters * ppm;
    const a = cx - span / 2;
    const b = cx + span / 2;
    lines.push({ x1: a, y1: y, x2: b, y2: y, role: "dim" });
    lines.push({ x1: a, y1: y - CAP, x2: a, y2: y + CAP, role: "cap" });
    lines.push({ x1: b, y1: y - CAP, x2: b, y2: y + CAP, role: "cap" });
    labels.push({ x: cx, y: y + LABEL_OFF, text, anchor: "middle" });
  };

  // Vertical dimension line (centered on cy) with caps + a side label.
  const vDim = (x: number, meters: number, text: string, side: "left" | "right"): void => {
    const span = meters * ppm;
    const a = cy - span / 2;
    const b = cy + span / 2;
    lines.push({ x1: x, y1: a, x2: x, y2: b, role: "dim" });
    lines.push({ x1: x - CAP, y1: a, x2: x + CAP, y2: a, role: "cap" });
    lines.push({ x1: x - CAP, y1: b, x2: x + CAP, y2: b, role: "cap" });
    const lx = side === "left" ? x - 8 : x + 8;
    labels.push({ x: lx, y: cy, text, anchor: side === "left" ? "end" : "start" });
  };

  if (axis === "front") {
    hDim(bottom + DIM_GAP, dims.width, `width ${formatMeters(dims.width)}`);
    hDim(bottom + DIM_GAP + DIM_STEP, dims.trackWidth, `track ${formatMeters(dims.trackWidth)}`);
    vDim(left - DIM_GAP, dims.height, `height ${formatMeters(dims.height)}`, "left");
  } else if (axis === "side") {
    hDim(bottom + DIM_GAP, dims.length, `length ${formatMeters(dims.length)}`);
    hDim(bottom + DIM_GAP + DIM_STEP, dims.wheelbase, `wheelbase ${formatMeters(dims.wheelbase)}`);
    vDim(left - DIM_GAP, dims.height, `height ${formatMeters(dims.height)}`, "left");
  } else {
    hDim(bottom + DIM_GAP, dims.width, `width ${formatMeters(dims.width)}`);
    hDim(bottom + DIM_GAP + DIM_STEP, dims.trackWidth, `track ${formatMeters(dims.trackWidth)}`);
    vDim(right + DIM_GAP, dims.length, `length ${formatMeters(dims.length)}`, "right");
    vDim(
      right + DIM_GAP + DIM_STEP,
      dims.wheelbase,
      `wheelbase ${formatMeters(dims.wheelbase)}`,
      "right",
    );
  }

  addScaleBar(lines, labels, ppm, vp);
  return { view, lines, labels };
}
