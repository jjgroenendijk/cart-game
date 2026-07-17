/**
 * Pure contact-sheet layout math for the garage compare mode: place the selected
 * views into a grid of equal cells so the composite PNG reads as one image. When
 * all four views are present the panels are positioned by their 2x2 quadrant
 * (front TL, side TR, iso BL, top BR) so the sheet mirrors the reference image;
 * any smaller/custom selection tiles row-major at up to two columns. Returns
 * plain pixel rects (the image area per panel, with a label band reserved above
 * it); garageCompare.ts blits renders + labels into them. No DOM/canvas.
 */

import { GARAGE_VIEWS, type GarageView } from "./garageViews";
import { QUADRANT_LAYOUT } from "./garageQuadrant";

/** Placement of one view's render cell (the image area, label band excluded). */
export interface PanelLayout {
  view: GarageView;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Split mode only: which half of the pair this cell is (absent in overlay). */
  role?: "model" | "ref";
}

/** The whole sheet: total pixel size plus each panel's render rect. */
export interface SheetLayout {
  width: number;
  height: number;
  panels: PanelLayout[];
}

export interface ContactSheetOpts {
  /** Pixel gap between cells (default 8). */
  gap?: number;
  /** Label band reserved directly above each render cell (default 20). */
  labelH?: number;
  /** Force a column count; ignored for the mirrored 4-view case. */
  cols?: number;
  /** Side-by-side: each view becomes a model + ref cell pair, one view per row. */
  split?: boolean;
}

/** True when `views` is exactly the four garage views (any order). */
function isFullSet(views: GarageView[]): boolean {
  return views.length === 4 && new Set(views).size === 4;
}

/**
 * Lay out `views` into a grid of `cell`-sized render rects. The full four-view
 * set mirrors the reference 2x2; otherwise cells tile row-major with
 * `cols` (default min(count, 2)) columns. `width`/`height` bound the whole sheet.
 */
export function contactSheetLayout(
  views: GarageView[],
  cell: { w: number; h: number },
  opts: ContactSheetOpts = {},
): SheetLayout {
  const gap = opts.gap ?? 8;
  const labelH = opts.labelH ?? 20;
  const slotH = cell.h + labelH;
  if (views.length === 0) return { width: 0, height: 0, panels: [] };

  const place = (view: GarageView, row: number, col: number): PanelLayout => ({
    view,
    x: col * (cell.w + gap),
    y: row * (slotH + gap) + labelH,
    w: cell.w,
    h: cell.h,
  });

  // Split: one view per row, model cell (col 0) beside its reference cell (col 1).
  if (opts.split) {
    const rows = views.length;
    const panels = views.flatMap((view, i) => [
      { ...place(view, i, 0), role: "model" as const },
      { ...place(view, i, 1), role: "ref" as const },
    ]);
    return {
      width: 2 * cell.w + gap,
      height: rows * slotH + (rows - 1) * gap,
      panels,
    };
  }

  let panels: PanelLayout[];
  let cols: number;
  let rows: number;
  if (isFullSet(views)) {
    cols = 2;
    rows = 2;
    panels = views.map((view) => {
      const { row, col } = QUADRANT_LAYOUT[view];
      return place(view, row, col);
    });
  } else {
    cols = Math.max(1, opts.cols ?? Math.min(views.length, 2));
    rows = Math.ceil(views.length / cols);
    panels = views.map((view, i) => place(view, Math.floor(i / cols), i % cols));
  }

  return {
    width: cols * cell.w + (cols - 1) * gap,
    height: rows * slotH + (rows - 1) * gap,
    panels,
  };
}

/** Filter/validate a `views` CSV (e.g. a URL param) to known views, in order. */
export function parseViews(csv: string | null | undefined): GarageView[] {
  if (!csv) return [...GARAGE_VIEWS];
  const seen = new Set<GarageView>();
  for (const tok of csv.split(",")) {
    const v = tok.trim();
    if ((GARAGE_VIEWS as readonly string[]).includes(v)) seen.add(v as GarageView);
  }
  return seen.size ? [...seen] : [...GARAGE_VIEWS];
}
