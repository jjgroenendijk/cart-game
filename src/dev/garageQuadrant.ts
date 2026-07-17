/**
 * Pure reference-grid geometry for the garage compare mode. The supplied
 * reference image is one bitmap laid out as an R x C grid of equal cells, one
 * per garage view; this module maps a view's grid cell to the sub-rectangle to
 * slice out. The default is the canonical 2x2 (top-left front, top-right side,
 * bottom-left iso 3/4, bottom-right top); `parseRefGrid` reads an arbitrary
 * layout (e.g. `front,side/top,rear`) so extra angles get a reference too. No
 * DOM/canvas: it returns plain pixel rects, unit-tested under jsdom;
 * garageCompare.ts does the actual drawImage crop.
 */

import type { GarageView } from "./garageViews";

/** A pixel-space source rectangle (drawImage crop) inside the reference image. */
export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Which of the 2x2 cells each view occupies (row 0 top, col 0 left). */
export const QUADRANT_LAYOUT: Record<GarageView, { row: 0 | 1; col: 0 | 1 }> = {
  front: { row: 0, col: 0 },
  side: { row: 0, col: 1 },
  iso: { row: 1, col: 0 },
  top: { row: 1, col: 1 },
};

/** Grid-cell boundary at fraction `i/n` of `total` px (floored, gap-free). */
function edge(i: number, n: number, total: number): number {
  return Math.floor((i * total) / n);
}

/**
 * Source rectangle for the `(row, col)` cell of an `rows`x`cols` grid over an
 * `imgW`x`imgH` reference image. Cell boundaries are floored fractions, so the
 * cells tile the image exactly with no gap or overlap (odd remainders fall to
 * the later cells). Generalizes quadrantRect to any grid size.
 */
export function cellRect(
  row: number,
  col: number,
  rows: number,
  cols: number,
  imgW: number,
  imgH: number,
): Rect {
  const sx = edge(col, cols, imgW);
  const sy = edge(row, rows, imgH);
  return { sx, sy, sw: edge(col + 1, cols, imgW) - sx, sh: edge(row + 1, rows, imgH) - sy };
}

/**
 * Source rectangle for a view's quadrant in an `imgW`x`imgH` reference image
 * (the default canonical 2x2 layout). Splits at the midpoint (floor), giving
 * the right/bottom cells any odd remainder so the four rects tile exactly.
 */
export function quadrantRect(view: GarageView, imgW: number, imgH: number): Rect {
  const { row, col } = QUADRANT_LAYOUT[view];
  return cellRect(row, col, 2, 2, imgW, imgH);
}

/** A parsed reference grid: total dims plus each view's cell position. */
export interface RefGrid {
  rows: number;
  cols: number;
  map: Record<GarageView, { row: number; col: number }>;
}

/**
 * Parse a reference-grid spec like `front,side/top,rear` — `/` separates rows,
 * `,` separates cells within a row — into an R x C grid mapping each named view
 * to its cell. Blank cells (e.g. `front,,top`) are skipped so a view can be
 * omitted. Returns null when empty or no view is mapped; unmapped views get no
 * reference (silhouette-only panel).
 */
export function parseRefGrid(csv: string | null | undefined): RefGrid | null {
  if (!csv) return null;
  const grid = csv.split("/").map((row) => row.split(",").map((c) => c.trim()));
  const rows = grid.length;
  const cols = Math.max(...grid.map((r) => r.length));
  if (rows < 1 || cols < 1) return null;
  const map: Record<GarageView, { row: number; col: number }> = {};
  grid.forEach((cells, row) => {
    cells.forEach((tok, col) => {
      if (tok) map[tok.toLowerCase()] = { row, col };
    });
  });
  return Object.keys(map).length ? { rows, cols, map } : null;
}
