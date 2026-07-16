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
import { applyStudioLight } from "../kart/studioLight";
import { formatDimensions, metersToRefPixels, pixelsPerMeter } from "./garageMeasure";
import {
  GARAGE_VIEWS,
  boundsCenter,
  isGarageView,
  isoFraming,
  orthoFraming,
  type GarageView,
} from "./garageViews";
import { buildOverlay } from "./garageOverlay";
import { renderOverlayInto } from "./garageOverlayDom";

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
  /** Read the current garage state. */
  snapshot(): GarageSnapshot;
  /** Stop RAF, free GL + object URLs, remove DOM + listeners. */
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const PANEL = [
  "position:absolute",
  "top:12px",
  "left:12px",
  "z-index:2",
  "display:flex",
  "flex-direction:column",
  "gap:8px",
  "padding:12px",
  "min-width:220px",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "color:#e8e8ea",
  "background:rgba(18,18,22,0.82)",
  "border:1px solid rgba(255,255,255,0.12)",
  "border-radius:8px",
].join(";");

const FIELD = "display:flex;justify-content:space-between;align-items:center;gap:8px";

function labelRow(text: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.style.cssText = FIELD;
  const span = document.createElement("span");
  span.textContent = text;
  row.append(span, control);
  return row;
}

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

/** Create an <input> of `type` with the given properties assigned. */
function input(type: string, props: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  Object.assign(el, props);
  return el;
}

/**
 * Build the garage viewer into `container`, or null when a WebGL context can't
 * be created (the guard runs before any DOM is built, so jsdom returns cleanly).
 */
export function createGarage(container: HTMLElement): GarageHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
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
  viewport.append(refImg, ruler, svg);
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

  function frameOrtho(): void {
    const vp = sizeOf();
    const f = orthoFraming(view, dims, vp);
    currentPpm = f.pixelsPerMeter;
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
  }

  function frameIso(): void {
    const vp = sizeOf();
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

  const readout = document.createElement("pre");
  readout.style.cssText = "margin:0;white-space:pre;color:#cfd2d8";

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
    showReference(URL.createObjectURL(file), true);
  }

  function clearReference(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    refImg.removeAttribute("src");
    refImg.style.display = "none";
    updateRuler();
  }

  const panel = document.createElement("div");
  panel.style.cssText = PANEL;
  const title = document.createElement("strong");
  title.textContent = "GARAGE";
  panel.appendChild(title);

  const viewSel = select(GARAGE_VIEWS.map((v) => ({ id: v, name: v })));
  viewSel.value = view;
  const onView = (): void => applyView(viewSel.value as GarageView);
  viewSel.addEventListener("change", onView);
  panel.appendChild(labelRow("view", viewSel));

  const variantSel = select(KART_VARIANTS.map((v) => ({ id: v.id, name: v.name })));
  variantSel.value = variantId;
  const onVariant = (): void => {
    variantId = variantSel.value as KartVariantId;
    rebuildKart();
    applyView(view);
  };
  variantSel.addEventListener("change", onVariant);
  panel.appendChild(labelRow("chassis", variantSel));

  const colorSel = select(KART_COLORWAYS.map((c) => ({ id: c.id, name: c.name })));
  colorSel.value = colorwayId;
  const onColor = (): void => {
    colorwayId = colorSel.value as KartColorwayId;
    rebuildKart();
    renderOnce();
  };
  colorSel.addEventListener("change", onColor);
  panel.appendChild(labelRow("paint", colorSel));

  panel.appendChild(readout);

  const boxToggle = input("checkbox");
  const onBox = (): void => {
    showBox = boxToggle.checked;
    refreshBox();
    renderOnce();
  };
  boxToggle.addEventListener("change", onBox);
  panel.appendChild(labelRow("bounds box", boxToggle));

  const gridToggle = input("checkbox", { checked: showGrid });
  const onGrid = (): void => setGrid(gridToggle.checked);
  gridToggle.addEventListener("change", onGrid);
  panel.appendChild(labelRow("ground grid", gridToggle));

  const fileInput = input("file", { accept: "image/*" });
  fileInput.style.cssText = "width:150px;color:#cfd2d8";
  const onFile = (): void => {
    const f = fileInput.files?.[0];
    if (f) loadReference(f);
  };
  fileInput.addEventListener("change", onFile);
  panel.appendChild(labelRow("reference", fileInput));

  const opacity = input("range", { min: "0", max: "1", step: "0.05", value: "0.5" });
  const onOpacity = (): void => {
    refImg.style.opacity = opacity.value;
  };
  opacity.addEventListener("input", onOpacity);
  panel.appendChild(labelRow("opacity", opacity));

  const meters = input("number", { min: "0", step: "0.1", placeholder: "ref width m" });
  meters.style.cssText = "width:80px;background:#26262c;color:#e8e8ea;border:1px solid #444";
  const onMeters = (): void => {
    realMeters = Number.parseFloat(meters.value) || 0;
    updateRuler();
  };
  meters.addEventListener("input", onMeters);
  panel.appendChild(labelRow("ref width (m)", meters));

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "clear reference";
  clearBtn.style.cssText =
    "background:#26262c;color:#e8e8ea;border:1px solid #444;border-radius:4px";
  clearBtn.addEventListener("click", clearReference);
  panel.appendChild(clearBtn);

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
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
