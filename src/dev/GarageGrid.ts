/**
 * Dev-only "container mall" grid viewer: renders the in-game kart mesh from every
 * requested angle SIMULTANEOUSLY as a contact sheet, each tile carrying its own
 * to-scale dimension overlay and an optional per-angle reference-contour image.
 * Reached via `?garage&layout=grid` (or `layout=gallery`); the plain `?garage`
 * single-view viewer stays in Garage.ts. Like createGarage it returns null
 * without WebGL (jsdom) and exposes an imperative agent API (setStyle /
 * setReference / setGrid / snapshot / dispose) so the shoot harness can drive it
 * headlessly.
 *
 * One WebGLRenderer + Scene + kart group; each tile is drawn by setting the
 * renderer viewport + scissor to the tile rect and calling renderer.render with
 * a per-view camera (ortho front/side/top framed to bounds -> exact px/m, or a
 * 3/4 iso perspective). The renderer keeps ACESFilmic tone mapping + sRGB output,
 * matching the single-view OutputPass path. Tile overlays + reference imgs are
 * absolutely-positioned DOM layers over the canvas. Reference images are
 * runtime-only: File drops use object URLs (revoked on replace/dispose); a URL /
 * data URI from setReference (or a `ref-<view>` URL param) is caller-owned.
 */

import * as THREE from "three";
import { buildKartVisual, disposeKartVisual } from "../kart/kartVisual";
import { applyStudioLight } from "../kart/studioLight";
import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";
import { KART_COLORWAYS, colorwayById, type KartColorwayId } from "../kart/kartColorways";
import { measureKart, type KartDimensions } from "../kart/models/measure";
import { boundsCenter, isoFraming, orthoFraming, type GarageView } from "./garageViews";
import { buildOverlay } from "./garageOverlay";
import { renderOverlayInto } from "./garageOverlayDom";
import { parseViewsParam, tileRects } from "./gridLayout";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Per-tile snapshot entry: measured dims, exact px/m (null on iso), pixel rect. */
export interface GarageGridTile {
  dimensions: KartDimensions;
  pixelsPerMeter: number | null;
  rect: { x: number; y: number; w: number; h: number };
}

/** Serializable grid state for the headless harness / snapshot test. */
export interface GarageGridSnapshot {
  variant: KartVariantId;
  colorway: KartColorwayId;
  views: GarageView[];
  tiles: Record<string, GarageGridTile>;
  viewport: { w: number; h: number };
}

export interface GarageGridHandle {
  /** Root element (screenshot target; class "gc-garage gc-garage-grid"). */
  readonly el: HTMLElement;
  /** Rebuild kart + measurements + overlays for a chassis/paint pick. */
  setStyle(variant: KartVariantId, colorway?: string): void;
  /** Inject/clear a reference contour bound to one view's tile. */
  setReference(view: GarageView, dataUrl: string | null, realMeters?: number): void;
  /** Toggle the metric grid on every ortho tile overlay. */
  setGrid(on: boolean): void;
  /** Read the current grid state. */
  snapshot(): GarageGridSnapshot;
  /** Stop RAF, free GL + object URLs, remove DOM + listeners. */
  dispose(): void;
}

interface Tile {
  view: GarageView;
  rect: { x: number; y: number; w: number; h: number };
  layer: HTMLDivElement;
  img: HTMLImageElement;
  svg: SVGElement;
  objectUrl: string | null;
  pixelsPerMeter: number | null;
}

const PANEL = [
  "position:absolute",
  "top:12px",
  "left:12px",
  "z-index:3",
  "display:flex",
  "gap:8px",
  "align-items:center",
  "padding:10px 12px",
  "font:12px/1.4 ui-monospace,Menlo,monospace",
  "color:#e8e8ea",
  "background:rgba(18,18,22,0.82)",
  "border:1px solid rgba(255,255,255,0.12)",
  "border-radius:8px",
].join(";");

function select<T extends string>(
  options: ReadonlyArray<{ id: T; name: string }>,
): HTMLSelectElement {
  const el = document.createElement("select");
  el.style.cssText = "background:#26262c;color:#e8e8ea;border:1px solid #444;border-radius:4px";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    el.append(opt);
  }
  return el;
}

/**
 * Build the grid viewer into `container`, or null when a WebGL context can't be
 * created (guard runs before any DOM is built, so jsdom returns cleanly).
 */
export function createGarageGrid(container: HTMLElement): GarageGridHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    // preserveDrawingBuffer keeps the last frame readable for headless captures.
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x14141a, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;display:block";

  const el = document.createElement("div");
  el.className = "gc-garage gc-garage-grid";
  el.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#14141a";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const isoCam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);

  const kart = new THREE.Group();
  scene.add(kart);
  const grid3d = new THREE.GridHelper(10, 20, 0x556070, 0x30363f);
  scene.add(grid3d);

  // Initial state from URL params (?variant=&colorway=&views=&grid=).
  const params = new URLSearchParams(location.search);
  const pVariant = params.get("variant");
  const pColor = params.get("colorway");
  const pGrid = params.get("grid");
  let variantId = (
    KART_VARIANTS.some((v) => v.id === pVariant) ? pVariant : KART_VARIANTS[0]!.id
  ) as KartVariantId;
  let colorwayId = (
    KART_COLORWAYS.some((c) => c.id === pColor) ? pColor : KART_COLORWAYS[0]!.id
  ) as KartColorwayId;
  let showGrid = pGrid == null ? true : !(pGrid === "0" || pGrid === "false" || pGrid === "off");
  grid3d.visible = showGrid;

  const views = parseViewsParam(params.get("views"));
  let dims: KartDimensions = measureKart(variantId);

  function sizeOf(): { w: number; h: number } {
    const rect = el.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1;
    const h = rect.height || window.innerHeight || 1;
    return { w, h };
  }

  // Build one DOM layer (reference img + overlay svg + label) per view tile.
  const tiles: Tile[] = views.map((view) => {
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;overflow:hidden;pointer-events:auto";
    const img = document.createElement("img");
    img.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;" +
      "opacity:0.5;pointer-events:none;display:none";
    const svg = document.createElementNS(SVG_NS, "svg");
    (svg as unknown as HTMLElement).style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    const label = document.createElement("span");
    label.textContent = view;
    label.style.cssText =
      "position:absolute;top:6px;right:8px;font:11px/1 ui-monospace,Menlo,monospace;" +
      "color:#cfd2d8;text-shadow:0 1px 2px #000;pointer-events:none";
    layer.append(img, svg, label);
    el.appendChild(layer);
    return {
      view,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      layer,
      img,
      svg,
      objectUrl: null,
      pixelsPerMeter: null,
    };
  });

  function frameOrtho(view: GarageView, rect: { w: number; h: number }): number {
    const f = orthoFraming(view, dims, rect);
    orthoCam.left = -f.frustumWidth / 2;
    orthoCam.right = f.frustumWidth / 2;
    orthoCam.top = f.frustumHeight / 2;
    orthoCam.bottom = -f.frustumHeight / 2;
    const c = boundsCenter(dims);
    const d = 12;
    if (view === "front") {
      orthoCam.up.set(0, 1, 0);
      orthoCam.position.set(c.x, c.y, c.z + d);
    } else if (view === "side") {
      orthoCam.up.set(0, 1, 0);
      orthoCam.position.set(c.x + d, c.y, c.z);
    } else {
      orthoCam.up.set(0, 0, -1);
      orthoCam.position.set(c.x, c.y + d, c.z);
    }
    orthoCam.lookAt(c.x, c.y, c.z);
    orthoCam.updateProjectionMatrix();
    return f.pixelsPerMeter;
  }

  function frameIso(rect: { w: number; h: number }): void {
    const iso = isoFraming(dims);
    const c = boundsCenter(dims);
    isoCam.fov = iso.fov;
    isoCam.aspect = rect.w / rect.h;
    const ce = Math.cos(iso.elevation);
    isoCam.position.set(
      c.x + iso.distance * ce * Math.sin(iso.azimuth),
      c.y + iso.distance * Math.sin(iso.elevation),
      c.z + iso.distance * ce * Math.cos(iso.azimuth),
    );
    isoCam.up.set(0, 1, 0);
    isoCam.lookAt(c.x, c.y, c.z);
    isoCam.updateProjectionMatrix();
  }

  function updateTileOverlay(tile: Tile): void {
    const { w, h } = tile.rect;
    tile.svg.setAttribute("width", String(w));
    tile.svg.setAttribute("height", String(h));
    tile.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    renderOverlayInto(
      tile.svg,
      buildOverlay(tile.view, dims, tile.pixelsPerMeter ?? 0, tile.rect),
      showGrid,
    );
  }

  /** Recompute tile rects + framing + overlays for the current size. */
  function layout(): void {
    const size = sizeOf();
    renderer.setSize(size.w, size.h, false);
    const rects = tileRects(views, size);
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i]!;
      const r = rects[i]!;
      tile.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
      tile.layer.style.cssText =
        `position:absolute;overflow:hidden;pointer-events:auto;` +
        `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      tile.pixelsPerMeter =
        tile.view === "iso" ? null : orthoFraming(tile.view, dims, tile.rect).pixelsPerMeter;
      updateTileOverlay(tile);
    }
  }

  function renderAll(): void {
    const size = sizeOf();
    renderer.setScissorTest(true);
    for (const tile of tiles) {
      const r = tile.rect;
      const bottom = size.h - (r.y + r.h); // GL viewport origin is bottom-left.
      renderer.setViewport(r.x, bottom, r.w, r.h);
      renderer.setScissor(r.x, bottom, r.w, r.h);
      let cam: THREE.Camera;
      if (tile.view === "iso") {
        frameIso(r);
        cam = isoCam;
      } else {
        frameOrtho(tile.view, r);
        cam = orthoCam;
      }
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(false);
  }

  function rebuildKart(): void {
    disposeKartVisual(kart);
    kart.clear();
    buildKartVisual(kart, variantId, colorwayById(colorwayId).colors);
    applyStudioLight(kart);
    dims = measureKart(variantId);
  }

  function setReferenceSrc(tile: Tile, src: string, isObjectUrl: boolean): void {
    if (tile.objectUrl) URL.revokeObjectURL(tile.objectUrl);
    tile.objectUrl = isObjectUrl ? src : null;
    tile.img.src = src;
    tile.img.style.display = "block";
  }

  function clearReference(tile: Tile): void {
    if (tile.objectUrl) URL.revokeObjectURL(tile.objectUrl);
    tile.objectUrl = null;
    tile.img.removeAttribute("src");
    tile.img.style.display = "none";
  }

  // Per-tile drag-drop of a reference image.
  const onDragOver = (e: DragEvent): void => e.preventDefault();
  const dropHandlers: Array<(e: DragEvent) => void> = [];
  for (const tile of tiles) {
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith("image/")) setReferenceSrc(tile, URL.createObjectURL(f), true);
    };
    tile.layer.addEventListener("dragover", onDragOver);
    tile.layer.addEventListener("drop", onDrop);
    dropHandlers.push(onDrop);
  }

  // Compact control panel: chassis, paint, grid.
  const panel = document.createElement("div");
  panel.style.cssText = PANEL;
  const variantSel = select(KART_VARIANTS.map((v) => ({ id: v.id, name: v.name })));
  variantSel.value = variantId;
  const colorSel = select(KART_COLORWAYS.map((c) => ({ id: c.id, name: c.name })));
  colorSel.value = colorwayId;
  const gridToggle = document.createElement("input");
  gridToggle.type = "checkbox";
  gridToggle.checked = showGrid;
  const onVariant = (): void => setStyle(variantSel.value as KartVariantId, colorwayId);
  const onColor = (): void => setStyle(variantId, colorSel.value);
  const onGridToggle = (): void => setGrid(gridToggle.checked);
  variantSel.addEventListener("change", onVariant);
  colorSel.addEventListener("change", onColor);
  gridToggle.addEventListener("change", onGridToggle);
  const gridLabel = document.createElement("label");
  gridLabel.style.cssText = "display:flex;align-items:center;gap:4px";
  const gridText = document.createElement("span");
  gridText.textContent = "grid";
  gridLabel.append(gridText, gridToggle);
  panel.append(variantSel, colorSel, gridLabel);
  el.appendChild(panel);

  function setGrid(on: boolean): void {
    showGrid = on;
    grid3d.visible = on;
    gridToggle.checked = on;
    for (const tile of tiles) updateTileOverlay(tile);
  }

  function setStyle(variant: KartVariantId, colorway?: string): void {
    if (!KART_VARIANTS.some((v) => v.id === variant)) return;
    variantId = variant;
    variantSel.value = variant;
    if (colorway && KART_COLORWAYS.some((c) => c.id === colorway)) {
      colorwayId = colorway as KartColorwayId;
      colorSel.value = colorway;
    }
    rebuildKart();
    layout();
  }

  const onResize = (): void => layout();
  window.addEventListener("resize", onResize);

  container.appendChild(el);
  rebuildKart();
  layout();

  // Apply any ref-<view> URL params now that tiles + measurements exist.
  for (const tile of tiles) {
    const ref = params.get(`ref-${tile.view}`);
    if (ref && ref.trim().length > 0) setReferenceSrc(tile, ref, false);
  }

  let raf = requestAnimationFrame(function frame(): void {
    raf = requestAnimationFrame(frame);
    renderAll();
  });

  return {
    el,
    setStyle,
    setReference(view: GarageView, dataUrl: string | null, _realMeters?: number): void {
      const tile = tiles.find((t) => t.view === view);
      if (!tile) return;
      if (dataUrl == null) clearReference(tile);
      else setReferenceSrc(tile, dataUrl, false);
    },
    setGrid,
    snapshot(): GarageGridSnapshot {
      const out: Record<string, GarageGridTile> = {};
      for (const tile of tiles) {
        out[tile.view] = {
          dimensions: dims,
          pixelsPerMeter: tile.pixelsPerMeter,
          rect: tile.rect,
        };
      }
      return {
        variant: variantId,
        colorway: colorwayId,
        views: [...views],
        tiles: out,
        viewport: sizeOf(),
      };
    },
    dispose(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i]!;
        tile.layer.removeEventListener("dragover", onDragOver);
        tile.layer.removeEventListener("drop", dropHandlers[i]!);
        if (tile.objectUrl) URL.revokeObjectURL(tile.objectUrl);
      }
      disposeKartVisual(kart);
      kart.clear();
      grid3d.geometry.dispose();
      (grid3d.material as THREE.Material).dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
