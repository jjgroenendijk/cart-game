/**
 * Canvas/WebGL glue for the garage compare mode: render each selected view as a
 * silhouette mask, key the matching reference quadrant, align + classify the
 * contour difference, and blit shaded model + diff overlay + label into one
 * contact-sheet canvas returned as a PNG data URL. All pixel/layout math is
 * delegated to the pure, unit-tested modules (garageMask / garageQuadrant /
 * garageRefScale / garageContactSheet); this file only owns the THREE render
 * passes, the 2D-canvas reads, and the compositing, so it is not jsdom-testable
 * (like Garage.ts). Driven imperatively by createGarage().compareSheet().
 */

import * as THREE from "three";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { GarageView } from "./garageViews";
import { contactSheetLayout, type PanelLayout } from "./garageContactSheet";
import { quadrantRect } from "./garageQuadrant";
import {
  backgroundMask,
  classifyDiff,
  diffStats,
  estimateBackground,
  luminanceMask,
  maskBounds,
  paintDiff,
  type DiffStats,
  type Mask,
} from "./garageMask";
import { refGoverningMeters, refPlacement, resampleMask, type RealDims } from "./garageRefScale";

/** Fixed per-view render cell (px); the sheet tiles these with a label band. */
export const COMPARE_CELL = { w: 480, h: 360 };

/** Garage-owned bits the compare pass drives (THREE state + framing closures). */
export interface CompareDeps {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scene: THREE.Scene;
  kart: THREE.Group;
  grid: THREE.GridHelper;
  /** Size renderer+composer to `cell`, frame `view`, return camera + exact px/m. */
  frame(
    view: GarageView,
    cell: { w: number; h: number },
  ): {
    camera: THREE.Camera;
    ppm: number | null;
  };
  /** Render the shaded model (composer + tone map) for the framed camera. */
  renderShaded(camera: THREE.Camera): void;
}

/** Per-view compare result: scale info plus the silhouette mismatch stats. */
export interface ViewCompare {
  pixelsPerMeter: number | null;
  metric: boolean;
  governMeters: number | null;
  stats: DiffStats | null;
}

/** The composite sheet (PNG data URL) plus per-view stats for the harness JSON. */
export interface CompareResult {
  dataUrl: string;
  views: Record<string, ViewCompare>;
}

/** The decoded reference sheet + the real-world dims anchoring its scale. */
export interface CompareOptions {
  refSheet: CanvasImageSource | null;
  refW: number;
  refH: number;
  real: RealDims;
  override?: Partial<Record<GarageView, keyof RealDims>>;
}

let whiteMat: THREE.MeshBasicMaterial | null = null;
function white(): THREE.MeshBasicMaterial {
  whiteMat ??= new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  return whiteMat;
}

interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function make2d(w: number, h: number): Canvas2D {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

/** Render the kart as flat white on black and threshold it to a silhouette mask. */
function modelSilhouette(deps: CompareDeps, camera: THREE.Camera): Mask {
  const saved: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
  deps.kart.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      saved.push([m, m.material]);
      m.material = white();
    }
  });
  const prevClear = new THREE.Color();
  deps.renderer.getClearColor(prevClear);
  const prevAlpha = deps.renderer.getClearAlpha();
  deps.renderer.setClearColor(0x000000, 1);
  deps.renderer.render(deps.scene, camera);
  deps.renderer.setClearColor(prevClear, prevAlpha);
  for (const [m, mat] of saved) m.material = mat;

  const { ctx } = make2d(COMPARE_CELL.w, COMPARE_CELL.h);
  ctx.drawImage(deps.renderer.domElement, 0, 0, COMPARE_CELL.w, COMPARE_CELL.h);
  const img = ctx.getImageData(0, 0, COMPARE_CELL.w, COMPARE_CELL.h);
  return luminanceMask(img.data, COMPARE_CELL.w, COMPARE_CELL.h);
}

/** Capture the shaded model render into a fresh panel canvas. */
function shadedPanel(deps: CompareDeps, camera: THREE.Camera): HTMLCanvasElement {
  deps.renderShaded(camera);
  const { canvas, ctx } = make2d(COMPARE_CELL.w, COMPARE_CELL.h);
  ctx.drawImage(deps.renderer.domElement, 0, 0, COMPARE_CELL.w, COMPARE_CELL.h);
  return canvas;
}

/** Slice + background-key the reference quadrant for a view into a mask. */
function refMaskFor(opts: CompareOptions, view: GarageView): Mask | null {
  if (!opts.refSheet) return null;
  const r = quadrantRect(view, opts.refW, opts.refH);
  if (r.sw <= 0 || r.sh <= 0) return null;
  const { ctx } = make2d(r.sw, r.sh);
  ctx.drawImage(opts.refSheet, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);
  const img = ctx.getImageData(0, 0, r.sw, r.sh);
  const bg = estimateBackground(img.data, r.sw, r.sh);
  return backgroundMask(img.data, r.sw, r.sh, bg);
}

/** Draw the view name + mismatch summary in the label band above a panel. */
function drawLabel(ctx: CanvasRenderingContext2D, panel: PanelLayout, view: ViewCompare): void {
  ctx.font = "14px ui-monospace, Menlo, monospace";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#e8e8ea";
  let text = panel.view.toUpperCase();
  if (view.stats) {
    const q = view.metric ? "" : "~"; // ~ marks non-metric (iso, qualitative)
    const s = view.stats;
    text += `  ${q}model+${s.modelOnlyPct}%  ref+${s.refOnlyPct}%  IoU ${s.iou}`;
  } else if (!view.metric && panel.view !== "iso") {
    text += "  (no ref dim)";
  }
  ctx.fillText(text, panel.x + 2, panel.y - 6);
}

/**
 * Render the compare contact sheet for `views`. Returns a PNG data URL plus
 * per-view stats. Renders at COMPARE_CELL with pixelRatio 1 (so getImageData
 * pixels match the px/m space), hides the grid, and restores renderer size +
 * grid on the way out; the caller re-applies the interactive view afterward.
 */
export function runCompare(
  deps: CompareDeps,
  views: GarageView[],
  opts: CompareOptions,
): CompareResult {
  const layout = contactSheetLayout(views, COMPARE_CELL);
  const { canvas: sheet, ctx } = make2d(Math.max(1, layout.width), Math.max(1, layout.height));
  ctx.fillStyle = "#14141a";
  ctx.fillRect(0, 0, layout.width, layout.height);

  const perView: Record<string, ViewCompare> = {};
  const prevGrid = deps.grid.visible;
  deps.grid.visible = false;
  const prevSize = new THREE.Vector2();
  deps.renderer.getSize(prevSize);
  const prevPixelRatio = deps.renderer.getPixelRatio();
  deps.renderer.setPixelRatio(1);

  try {
    for (const panel of layout.panels) {
      const { camera, ppm } = deps.frame(panel.view, COMPARE_CELL);
      const panelCanvas = shadedPanel(deps, camera);
      const modelMask = modelSilhouette(deps, camera);
      const modelBounds = maskBounds(modelMask);
      const governMeters = refGoverningMeters(panel.view, opts.real, opts.override);

      let stats: DiffStats | null = null;
      let metric = false;
      const refMask = refMaskFor(opts, panel.view);
      const refBounds = refMask ? maskBounds(refMask) : null;
      if (refMask && refBounds && !refBounds.empty && !modelBounds.empty) {
        const placement = refPlacement(panel.view, refBounds, modelBounds, ppm, governMeters);
        metric = placement.metric;
        const aligned = resampleMask(refMask, placement, COMPARE_CELL.w, COMPARE_CELL.h);
        const diff = classifyDiff(modelMask, aligned);
        stats = diffStats(diff);
        const overlay = paintDiff(diff);
        const { canvas: oc, ctx: octx } = make2d(COMPARE_CELL.w, COMPARE_CELL.h);
        const overlayData = octx.createImageData(COMPARE_CELL.w, COMPARE_CELL.h);
        overlayData.data.set(overlay);
        octx.putImageData(overlayData, 0, 0);
        panelCanvas.getContext("2d")!.drawImage(oc, 0, 0);
      }

      const view: ViewCompare = { pixelsPerMeter: ppm, metric, governMeters, stats };
      ctx.drawImage(panelCanvas, panel.x, panel.y);
      drawLabel(ctx, panel, view);
      perView[panel.view] = view;
    }
  } finally {
    deps.renderer.setPixelRatio(prevPixelRatio);
    deps.renderer.setSize(prevSize.x, prevSize.y, false);
    deps.composer.setSize(prevSize.x, prevSize.y);
    deps.grid.visible = prevGrid;
  }

  return { dataUrl: sheet.toDataURL("image/png"), views: perView };
}

/** Free the shared silhouette material (call from Garage.dispose). */
export function disposeCompare(): void {
  whiteMat?.dispose();
  whiteMat = null;
}
