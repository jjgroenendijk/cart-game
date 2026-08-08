/**
 * Dev-only "garage" viewer: inspect any kart chassis + paint in isolation and
 * read its real measured dimensions from to-scale renders. Alongside the human
 * orbit UI it exposes an imperative API (setStyle/setView/setGrid/setReference/
 * snapshot) so a headless harness — and a vision-capable agent — can shoot
 * named, true-to-scale views with burned-in dimension annotations, read the
 * numbers, edit the kart model def, and re-shoot. Reached via `?garage`.
 *
 * front/side/top use an OrthographicCamera framed to the measured bounds, so a
 * screenshot maps meters -> pixels at an exact, deterministic scale; an SVG
 * overlay (from the pure src/dev/garageOverlay.ts) draws a metric grid, a 1 m
 * scale bar, and labeled dimension lines. iso keeps a 3/4 PerspectiveCamera with
 * OrbitControls (no 2D dimension lines). Reuses the KartPreview render pattern
 * (private WebGLRenderer + EffectComposer, fixed studio light); returns null
 * without WebGL (jsdom). Reference images are runtime-only: object URLs are
 * revoked on replace/dispose, a data URL passed to setReference is caller-owned.
 */

import * as THREE from "three";
import { buildKartVisual, disposeKartVisual } from "../kart/kartVisual";
import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";
import { KART_COLORWAYS, colorwayById, type KartColorwayId } from "../kart/kartColorways";
import { measureKart, type KartDimensions } from "../kart/models/measure";
import { formatDimensions, metersToRefPixels, pixelsPerMeter } from "./garageMeasure";
import {
  boundsCenter,
  isoFraming,
  orthoPose,
  resolveView,
  viewFraming,
  VIEW_PRESETS,
  type GarageView,
  type ViewSpec,
} from "./garageViews";
import { buildOverlay } from "./garageOverlay";
import { renderOverlayInto } from "./garageSvg";
import { buildGaragePanel } from "./garagePanel";
import { parseViews } from "./garageContactSheet";
import { parseRefGrid, type RefGrid } from "./garageQuadrant";
import { disposeCompare, runCompare, type CompareResult } from "./garageCompare";
import { applyStudioLight, buildGarageChrome } from "./garageDom";
import type { RealDims } from "./garageRefScale";

export type { GarageView } from "./garageViews";

/** Compact serializable garage state for a headless harness / snapshot test. */
export interface GarageSnapshot {
  variant: KartVariantId;
  colorway: KartColorwayId;
  view: GarageView;
  dimensions: KartDimensions;
  /** Exact px/m on ortho views; null on the iso (perspective) view. */
  pixelsPerMeter: number | null;
  viewport: { w: number; h: number };
}

export interface GarageHandle {
  /** Root element (screenshot target; class "gc-garage"). */
  readonly el: HTMLElement;
  /** Rebuild kart + measurements + overlay for a chassis/paint pick. */
  setStyle(variant: KartVariantId, colorway?: string): void;
  /** Switch camera + overlay; renders at least one frame synchronously. */
  setView(view: GarageView): void;
  /** Toggle the ground grid (3D + SVG). */
  setGrid(on: boolean): void;
  /** Inject/clear a reference image; a data URL is caller-owned (not revoked). */
  setReference(dataUrl: string | null, realMeters?: number): void;
  /** Set/clear the 2x2 reference sheet for compare mode (decoded async). */
  setReferenceSheet(dataUrl: string | null): Promise<void>;
  /** Set the real-world car dims (meters) + optional per-view governing dim. */
  setRealDims(real: RealDims, govern?: Partial<Record<GarageView, keyof RealDims>>): void;
  /** Render a compare contact sheet for `views` (default: URL/all); async decode. */
  compareSheet(views?: GarageView[]): Promise<CompareResult>;
  /** Read the current garage state. */
  snapshot(): GarageSnapshot;
  /** Stop RAF, free GL + object URLs, remove DOM + listeners. */
  dispose(): void;
}

const REAL_DIM_KEYS = ["length", "width", "height"] as const;

/** Parse positive `length`/`width`/`height` (meters) URL params into RealDims. */
function parseRealDims(params: URLSearchParams): RealDims {
  const out: RealDims = {};
  for (const key of REAL_DIM_KEYS) {
    const n = Number.parseFloat(params.get(key) ?? "");
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/** Parse a `govern` param like "top=length,front=width" into a per-view map. */
function parseGovern(csv: string | null): Partial<Record<GarageView, keyof RealDims>> | undefined {
  if (!csv) return undefined;
  const map: Partial<Record<GarageView, keyof RealDims>> = {};
  for (const pair of csv.split(",")) {
    const [v, d] = pair.split("=").map((s) => s.trim());
    const spec = resolveView(v);
    if (spec && (REAL_DIM_KEYS as readonly string[]).includes(d ?? "")) {
      map[spec.id] = d as keyof RealDims;
    }
  }
  return Object.keys(map).length ? map : undefined;
}

/**
 * Build the garage viewer into `container`, or null when a WebGL context can't
 * be created (the guard runs before any DOM is built, so jsdom returns cleanly).
 */
export function createGarage(container: HTMLElement): GarageHandle | null {
  const chrome = buildGarageChrome();
  if (!chrome) return null;
  const {
    renderer,
    el,
    viewport,
    refImg,
    ruler,
    rulerTag,
    svg,
    compareImg,
    scene,
    orthoCam,
    isoCam,
    controls,
    composer,
    renderPass,
    kart,
    grid,
  } = chrome;
  let activeCamera: THREE.Camera = isoCam;
  let boxHelper: THREE.Box3Helper | null = null;

  // Initial state, overridable by URL params (?variant=&colorway=&view=&grid=).
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
  let currentSpec: ViewSpec = resolveView(params.get("view")) ?? VIEW_PRESETS.iso!;
  let view: GarageView = currentSpec.id;
  let showGrid = pGrid == null ? true : !(pGrid === "0" || pGrid === "false" || pGrid === "off");
  grid.visible = showGrid;

  let dims: KartDimensions = measureKart(variantId);
  let showBox = false;
  let objectUrl: string | null = null;
  let realMeters = 0;
  let currentPpm: number | null = null;

  // Compare-mode state (2x2 reference sheet + agent-supplied real dims).
  const compareMode = params.has("compare");
  // ?split lays each view out as a model cell beside a reference cell (not an overlay).
  const splitMode = params.has("split");
  const defaultViews = parseViews(params.get("views"));
  let refSheetImg: HTMLImageElement | null = null;
  let realDims: RealDims = parseRealDims(params);
  let govern = parseGovern(params.get("govern"));
  const refGrid: RefGrid | null = parseRefGrid(params.get("refgrid"));

  function sizeOf(): { w: number; h: number } {
    const rect = el.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1;
    const h = rect.height || window.innerHeight || 1;
    return { w, h };
  }

  function renderOnce(): void {
    renderPass.mainCamera = activeCamera;
    composer.render();
  }

  function frameOrtho(spec: ViewSpec = currentSpec, vp = sizeOf()): void {
    const ext = viewFraming(spec, dims, vp);
    currentPpm = ext.pixelsPerMeter;
    orthoCam.left = -ext.frustumWidth / 2;
    orthoCam.right = ext.frustumWidth / 2;
    orthoCam.top = ext.frustumHeight / 2;
    orthoCam.bottom = -ext.frustumHeight / 2;
    const c = boundsCenter(dims);
    const d = 12;
    const { up, eye } = orthoPose(spec);
    orthoCam.up.set(up.x, up.y, up.z);
    orthoCam.position.set(c.x + d * eye.x, c.y + d * eye.y, c.z + d * eye.z);
    orthoCam.lookAt(c.x, c.y, c.z);
    orthoCam.updateProjectionMatrix();
  }

  function frameIso(spec: ViewSpec = currentSpec, vp = sizeOf()): void {
    const iso = isoFraming(dims, spec.azimuth, spec.elevation);
    const c = boundsCenter(dims);
    isoCam.fov = iso.fov;
    isoCam.aspect = vp.w / vp.h;
    const ce = Math.cos(iso.elevation);
    isoCam.position.set(
      c.x + iso.distance * ce * Math.sin(iso.azimuth),
      c.y + iso.distance * Math.sin(iso.elevation),
      c.z + iso.distance * ce * Math.cos(iso.azimuth),
    );
    isoCam.up.set(0, 1, 0);
    isoCam.lookAt(c.x, c.y, c.z);
    isoCam.updateProjectionMatrix();
    controls.target.set(c.x, c.y, c.z);
    controls.update();
    currentPpm = null;
  }

  function updateOverlay(): void {
    const vp = sizeOf();
    svg.setAttribute("width", String(vp.w));
    svg.setAttribute("height", String(vp.h));
    svg.setAttribute("viewBox", `0 0 ${vp.w} ${vp.h}`);
    renderOverlayInto(svg, buildOverlay(view, dims, currentPpm ?? 0, vp), showGrid);
  }

  function applyView(v: GarageView): void {
    currentSpec = resolveView(v) ?? VIEW_PRESETS.iso!;
    view = currentSpec.id;
    if (currentSpec.ortho) {
      activeCamera = orthoCam;
      controls.enabled = false;
      frameOrtho(currentSpec);
    } else {
      activeCamera = isoCam;
      controls.enabled = true;
      frameIso(currentSpec);
    }
    renderPass.mainCamera = activeCamera;
    viewSel.value = currentSpec.id; // arbitrary tokens simply match no option
    updateOverlay();
    renderOnce();
  }

  function resize(): void {
    const { w, h } = sizeOf();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    isoCam.aspect = w / h;
    isoCam.updateProjectionMatrix();
    if (currentSpec.ortho) frameOrtho(currentSpec);
    updateOverlay();
    renderOnce();
  }

  function refreshBox(): void {
    if (boxHelper) {
      scene.remove(boxHelper);
      boxHelper.geometry.dispose();
      boxHelper = null;
    }
    if (!showBox) return;
    const box = new THREE.Box3().setFromObject(kart);
    if (box.isEmpty()) return;
    boxHelper = new THREE.Box3Helper(box, new THREE.Color(0x4fc3f7));
    scene.add(boxHelper);
  }

  function updateRuler(): void {
    const refW = refImg.getBoundingClientRect().width || refImg.naturalWidth;
    const pxPerM = pixelsPerMeter(refW, realMeters);
    const shown = refImg.style.display !== "none" && pxPerM > 0;
    ruler.style.display = shown ? "block" : "none";
    if (!shown) return;
    ruler.style.width = `${metersToRefPixels(dims.length, pxPerM)}px`;
    rulerTag.textContent = `${pxPerM.toFixed(0)} px/m · kart ${dims.length.toFixed(2)} m`;
  }

  function updateMeasurements(): void {
    dims = measureKart(variantId);
    readout.textContent = formatDimensions(dims).join("\n");
  }

  function rebuildKart(): void {
    disposeKartVisual(kart);
    kart.clear();
    buildKartVisual(kart, variantId, colorwayById(colorwayId).colors);
    applyStudioLight(kart);
    updateMeasurements();
    refreshBox();
    updateRuler();
  }

  function showReference(src: string, isObjectUrl: boolean): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = isObjectUrl ? src : null;
    refImg.src = src;
    refImg.style.display = "block";
  }

  function loadReference(file: File): void {
    if (!file.type.startsWith("image/")) return;
    if (compareMode) {
      // In compare mode a loaded image is the 2x2 reference sheet: decode + re-run.
      const reader = new FileReader();
      reader.onload = (): void => {
        void setReferenceSheet(String(reader.result)).then(() => compareSheet());
      };
      reader.readAsDataURL(file);
      return;
    }
    showReference(URL.createObjectURL(file), true);
  }

  async function setReferenceSheet(dataUrl: string | null): Promise<void> {
    if (dataUrl == null) {
      refSheetImg = null;
      compareImg.removeAttribute("src");
      compareImg.style.display = "none";
      return;
    }
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    refSheetImg = img;
  }

  function setRealDims(real: RealDims, g?: Partial<Record<GarageView, keyof RealDims>>): void {
    realDims = { ...real };
    govern = g;
  }

  /** Size renderer+composer to `cell`, frame `v`, and report the camera + px/m. */
  function frameForCompare(
    v: GarageView,
    cell: { w: number; h: number },
  ): { camera: THREE.Camera; ppm: number | null } {
    renderer.setSize(cell.w, cell.h, false);
    composer.setSize(cell.w, cell.h);
    const spec = resolveView(v) ?? VIEW_PRESETS.iso!;
    if (!spec.ortho) {
      isoCam.aspect = cell.w / cell.h;
      frameIso(spec, cell);
      return { camera: isoCam, ppm: null };
    }
    frameOrtho(spec, cell);
    return { camera: orthoCam, ppm: currentPpm };
  }

  function renderShaded(camera: THREE.Camera): void {
    renderPass.mainCamera = camera;
    composer.render();
  }

  function compareSheet(views: GarageView[] = defaultViews): Promise<CompareResult> {
    const result = runCompare(
      { renderer, composer, scene, kart, grid, frame: frameForCompare, renderShaded },
      views,
      {
        refSheet: refSheetImg,
        refW: refSheetImg?.naturalWidth ?? 0,
        refH: refSheetImg?.naturalHeight ?? 0,
        real: realDims,
        override: govern,
        grid: refGrid,
        split: splitMode,
      },
    );
    // runCompare restored renderer size; re-apply the interactive view + overlay.
    resize();
    applyView(view);
    if (compareMode) {
      compareImg.src = result.dataUrl;
      compareImg.style.display = "block";
    }
    return Promise.resolve(result);
  }

  function clearReference(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    refImg.removeAttribute("src");
    refImg.style.display = "none";
    updateRuler();
  }

  const { panel, controls: panelControls } = buildGaragePanel(
    { view, variant: variantId, colorway: colorwayId, showGrid },
    {
      onView: (v) => applyView(v),
      onVariant: (id) => {
        variantId = id;
        rebuildKart();
        applyView(view);
        if (compareMode) void compareSheet();
      },
      onColor: (id) => {
        colorwayId = id;
        rebuildKart();
        renderOnce();
        if (compareMode) void compareSheet();
      },
      onBox: (on) => {
        showBox = on;
        refreshBox();
        renderOnce();
      },
      onGrid: (on) => setGrid(on),
      onFile: (f) => loadReference(f),
      onOpacity: (value) => {
        refImg.style.opacity = value;
      },
      onMeters: (value) => {
        realMeters = Number.parseFloat(value) || 0;
        updateRuler();
      },
      onClear: () => clearReference(),
    },
  );
  const { viewSel, variantSel, colorSel, gridToggle, meters, readout } = panelControls;
  el.appendChild(panel);

  function setGrid(on: boolean): void {
    showGrid = on;
    grid.visible = on;
    gridToggle.checked = on;
    updateOverlay();
    renderOnce();
  }

  // Drag-drop a reference image onto the viewport.
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) loadReference(f);
  };
  viewport.addEventListener("dragover", onDragOver);
  viewport.addEventListener("drop", onDrop);
  window.addEventListener("resize", resize);
  refImg.addEventListener("load", updateRuler);

  container.appendChild(el);
  resize();
  rebuildKart();
  applyView(view);
  // ?compare seeds an initial contact sheet (silhouettes only until a ref loads).
  if (compareMode) void compareSheet();

  let raf = requestAnimationFrame(function frame(): void {
    raf = requestAnimationFrame(frame);
    controls.update();
    renderPass.mainCamera = activeCamera;
    composer.render();
  });

  return {
    el,
    setStyle(variant: KartVariantId, colorway?: string): void {
      if (!KART_VARIANTS.some((v) => v.id === variant)) return;
      variantId = variant;
      variantSel.value = variant;
      if (colorway && KART_COLORWAYS.some((c) => c.id === colorway)) {
        colorwayId = colorway as KartColorwayId;
        colorSel.value = colorway;
      }
      rebuildKart();
      applyView(view);
    },
    setView(v: GarageView): void {
      if (!resolveView(v)) return;
      applyView(v);
    },
    setGrid,
    setReference(dataUrl: string | null, real?: number): void {
      if (dataUrl == null) {
        clearReference();
        return;
      }
      if (real !== undefined) {
        realMeters = real;
        meters.value = String(real);
      }
      showReference(dataUrl, false);
      updateRuler();
    },
    setReferenceSheet,
    setRealDims,
    compareSheet,
    snapshot(): GarageSnapshot {
      return {
        variant: variantId,
        colorway: colorwayId,
        view,
        dimensions: dims,
        pixelsPerMeter: currentSpec.ortho ? currentPpm : null,
        viewport: sizeOf(),
      };
    },
    dispose(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      viewport.removeEventListener("dragover", onDragOver);
      viewport.removeEventListener("drop", onDrop);
      refImg.removeEventListener("load", updateRuler);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      disposeKartVisual(kart);
      kart.clear();
      if (boxHelper) boxHelper.geometry.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      disposeCompare();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
