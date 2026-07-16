/**
 * Pure, WebGL-free tiling math for the garage grid ("container mall") layout
 * (src/dev/GarageGrid.ts). Given the canvas size and an ordered list of views it
 * lays them out in a near-square grid and returns each view's pixel rect
 * `{x, y, w, h}` (top-left origin, matching CSS/DOM), plus helpers to parse the
 * `views` URL param. GarageGrid feeds each rect to the existing per-view framing
 * (orthoFraming/isoFraming) sized to that tile, so every tile stays exactly
 * to-scale. No THREE, no DOM, so this is unit-tested under jsdom.
 */

import { GARAGE_VIEWS, isGarageView, type GarageView } from "./garageViews";

/** Pixel rect of one tile: top-left origin (x right, y down), like the DOM. */
export interface TileRect {
  view: GarageView;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Grid shape: columns x rows chosen near-square for `count` tiles. */
export interface GridShape {
  cols: number;
  rows: number;
}

/**
 * Columns x rows for `count` tiles, near-square with columns favored (so 2 -> 2x1,
 * 3 -> 2x2, 4 -> 2x2, 5..6 -> 3x2). count <= 0 collapses to a single empty cell.
 */
export function gridShape(count: number): GridShape {
  const n = Math.max(1, Math.floor(count));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * Lay `views` into a near-square grid filling `{w,h}` in row-major order. Each
 * tile is an equal cell (last row may be under-filled); rects use a top-left
 * origin so they map straight onto absolutely-positioned DOM overlays. An empty
 * `views` yields no rects.
 */
export function tileRects(
  views: readonly GarageView[],
  size: { w: number; h: number },
): TileRect[] {
  if (views.length === 0) return [];
  const { cols, rows } = gridShape(views.length);
  const cellW = size.w / cols;
  const cellH = size.h / rows;
  return views.map((view, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { view, x: col * cellW, y: row * cellH, w: cellW, h: cellH };
  });
}

/**
 * Parse a `views` URL param (comma list) into a de-duplicated, validated view
 * list in the given order. Unknown tokens are dropped; an empty/absent/all-bad
 * value falls back to the full GARAGE_VIEWS set so a bare `?layout=grid` still
 * shows every angle.
 */
export function parseViewsParam(raw: string | null): GarageView[] {
  if (raw == null) return [...GARAGE_VIEWS];
  const seen = new Set<GarageView>();
  for (const token of raw.split(",")) {
    const v = token.trim().toLowerCase();
    if (isGarageView(v)) seen.add(v);
  }
  return seen.size > 0 ? [...seen] : [...GARAGE_VIEWS];
}
