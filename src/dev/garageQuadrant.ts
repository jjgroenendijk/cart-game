/**
 * Pure 2x2 quadrant geometry for the garage compare mode. The supplied reference
 * image is one square laid out as four equal quadrants — top-left front,
 * top-right side, bottom-left iso 3/4, bottom-right top — matching the garage's
 * own views. This module maps a GarageView to the sub-rectangle to slice out of
 * the reference bitmap. No DOM/canvas: it returns plain pixel rects, unit-tested
 * under jsdom; garageCompare.ts does the actual drawImage crop.
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

/**
 * Source rectangle for a view's quadrant in an `imgW`x`imgH` reference image.
 * Splits at the midpoint (floor), giving the right/bottom cells any odd
 * remainder so the four rects tile the image exactly with no gap or overlap.
 */
export function quadrantRect(view: GarageView, imgW: number, imgH: number): Rect {
  const { row, col } = QUADRANT_LAYOUT[view];
  const midX = Math.floor(imgW / 2);
  const midY = Math.floor(imgH / 2);
  const sx = col === 0 ? 0 : midX;
  const sy = row === 0 ? 0 : midY;
  const sw = col === 0 ? midX : imgW - midX;
  const sh = row === 0 ? midY : imgH - midY;
  return { sx, sy, sw, sh };
}
