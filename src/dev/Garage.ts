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
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildKartVisual, disposeKartVisual } from "../kart/kartVisual";
import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";
import { KART_COLORWAYS, colorwayById, type KartColorwayId } from "../kart/kartColorways";
import { measureKart, type KartDimensions } from "../kart/models/measure";
import { formatDimensions, metersToRefPixels, pixelsPerMeter } from "./garageMeasure";
import {
  boundsCenter,
  isGarageView,
  isoFraming,
  orthoFraming,
  type GarageView,
} from "./garageViews";
import { buildOverlay } from "./garageOverlay";
import { SVG_NS, renderOverlayInto } from "./garageSvg";
import { buildGaragePanel } from "./garagePanel";
import { parseViews } from "./garageContactSheet";
import { disposeCompare, runCompare, type CompareResult } from "./garageCompare";
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

/** Fixed studio light in the garage camera's view space (mirrors KartPreview). */
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.6).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9);
const AMBIENT = new THREE.Color(0.4, 0.42, 0.48);

/** Swap in garage-local light uniform objects on every cel material. */
function applyStudioLight(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (!u || !u.uSunDir) continue;
      u.uSunDir = { value: SUN_DIR };
      u.uSunColor = { value: SUN_COLOR };
      u.uAmbient = { value: AMBIENT };
      u.uShadowFade = { value: 1 };
    }
  });
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
    if (isGarageView(v) && (REAL_DIM_KEYS as readonly string[]).includes(d ?? "")) {
      map[v] = d as keyof RealDims;
    }
  }
  return Object.keys(map).length ? map : undefined;
}

/**
 * Build the garage viewer into `container`, or null when a WebGL context can't
 * be created (the guard runs before any DOM is built, so jsdom returns cleanly).
 */
export function createGarage(container: HTMLElement): GarageHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    // preserveDrawingBuffer lets compare mode read back pixels via drawImage of
    // the GL canvas synchronously (silhouette + shaded passes) without a compositor.
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
  el.className = "gc-garage";
  el.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#14141a";
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:absolute;inset:0";
  viewport.appendChild(renderer.domElement);

  const refImg = document.createElement("img");
  refImg.style.cssText =
    "position:absolute;top:0;left:0;max-width:100%;pointer-events:none;opacity:0.5;display:none";
  const ruler = document.createElement("div");
  ruler.style.cssText =
    "position:absolute;left:12px;bottom:12px;height:0;border-top:2px solid #ffd23f;display:none";
  const rulerTag = document.createElement("span");
  rulerTag.style.cssText =
    "position:absolute;bottom:2px;left:0;font:11px/1 monospace;color:#ffd23f";
  ruler.appendChild(rulerTag);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "gc-garage-overlay");
  (svg as unknown as HTMLElement).style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
  // Compare-mode composite sheet, shown over the canvas when ?compare is set.
  const compareImg = document.createElement("img");
  compareImg.className = "gc-garage-compare";
  compareImg.style.cssText =
    "position:absolute;inset:0;margin:auto;max-width:100%;max-height:100%;" +
    "pointer-events:none;display:none;z-index:1;background:#14141a";
  viewport.append(refImg, ruler, svg, compareImg);
  el.appendChild(viewport);

  const scene = new THREE.Scene();
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const isoCam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  let activeCamera: THREE.Camera = isoCam;
  const controls = new OrbitControls(isoCam, renderer.domElement);
  controls.enableDamping = true;

  const kart = new THREE.Group();
  scene.add(kart);
  const grid = new THREE.GridHelper(10, 20, 0x556070, 0x30363f);
  scene.add(grid);
  let boxHelper: THREE.Box3Helper | null = null;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, isoCam);
  composer.addPass(renderPass);
  composer.addPass(new OutputPass());

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
  let view: GarageView = isGarageView(params.get("view"))
    ? (params.get("view") as GarageView)
    : "iso";
  let showGrid = pGrid == null ? true : !(pGrid === "0" || pGrid === "false" || pGrid === "off");
  grid.visible = showGrid;

  let dims: KartDimensions = measureKart(variantId);
  let showBox = false;
  let objectUrl: string | null = null;
  let realMeters = 0;
  let currentPpm: number | null = null;

  // Compare-mode state (2x2 reference sheet + agent-supplied real dims).
  const compareMode = params.has("compare");
  const defaultViews = parseViews(params.get("views"));
  let refSheetImg: HTMLImageElement | null = null;
  let realDims: RealDims = parseRealDims(params);
  let govern = parseGovern(params.get("govern"));

  function sizeOf(): { w: number; h: number } {
    const rect = el.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1;
    const h = rect.height || window.innerHeight || 1;
    return { w, h };
  }

  function renderOnce(): void {
    renderPass.camera = activeCamera;
    composer.render();
  }

  function frameOrtho(v: GarageView = view, vp = sizeOf()): void {
    const f = orthoFraming(v, dims, vp);
    currentPpm = f.pixelsPerMeter;
    orthoCam.left = -f.frustumWidth / 2;
    orthoCam.right = f.frustumWidth / 2;
    orthoCam.top = f.frustumHeight / 2;
    orthoCam.bottom = -f.frustumHeight / 2;
    const c = boundsCenter(dims);
    const d = 12;
    if (v === "front") {
      orthoCam.up.set(0, 1, 0);
      orthoCam.position.set(c.x, c.y, c.z + d);
    } else if (v === "side") {
      orthoCam.up.set(0, 1, 0);
      orthoCam.position.set(c.x + d, c.y, c.z);
    } else {
      orthoCam.up.set(0, 0, -1);
      orthoCam.position.set(c.x, c.y + d, c.z);
    }
    orthoCam.lookAt(c.x, c.y, c.z);
    orthoCam.updateProjectionMatrix();
  }

  function frameIso(vp = sizeOf()): void {
    const iso = isoFraming(dims);
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
    view = v;
    if (v === "iso") {
      activeCamera = isoCam;
      controls.enabled = true;
      frameIso();
    } else {
      activeCamera = orthoCam;
      controls.enabled = false;
      frameOrtho();
    }
    renderPass.camera = activeCamera;
    viewSel.value = v;
    updateOverlay();
    renderOnce();
  }

  function resize(): void {
    const { w, h } = sizeOf();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    isoCam.aspect = w / h;
    isoCam.updateProjectionMatrix();
    if (view !== "iso") frameOrtho();
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
    if (v === "iso") {
      isoCam.aspect = cell.w / cell.h;
      frameIso(cell);
      return { camera: isoCam, ppm: null };
    }
    frameOrtho(v, cell);
    return { camera: orthoCam, ppm: currentPpm };
  }

  function renderShaded(camera: THREE.Camera): void {
    renderPass.camera = camera;
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
    renderPass.camera = activeCamera;
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
      if (!isGarageView(v)) return;
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
        pixelsPerMeter: view === "iso" ? null : currentPpm,
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
