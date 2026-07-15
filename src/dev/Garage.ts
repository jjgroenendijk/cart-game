/**
 * Dev-only "garage" viewer: inspect any kart chassis + paint in isolation with
 * orbit/zoom/pan, read its real measured dimensions, and overlay a
 * USER-SUPPLIED reference image (file pick or drag-drop) for visual proportion
 * comparison. Reached via the `?garage` dev URL flag (main.ts wires the route).
 *
 * Reuses the proven KartPreview pattern: a private WebGLRenderer + EffectComposer
 * (RenderPass -> OutputPass, ACES/sRGB) and the fixed-studio-light override on cel
 * materials (the shared lightUniforms track the day cycle, which would light the
 * isolated kart from arbitrary directions). createGarage returns null where WebGL
 * is unavailable (jsdom), so unit tests and headless runs keep working.
 *
 * Reference images are strictly runtime-only: loaded via URL.createObjectURL and
 * revoked on replace/dispose. Nothing is ever written to disk or committed.
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

export interface GarageHandle {
  /** Root element mounted into the container. */
  readonly el: HTMLElement;
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

  // Root + viewport (canvas + reference overlay layer).
  const el = document.createElement("div");
  el.className = "gc-garage";
  el.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#14141a";
  const viewport = document.createElement("div");
  viewport.style.cssText = "position:absolute;inset:0";
  viewport.appendChild(renderer.domElement);

  // Reference image + on-screen ruler, layered over the canvas.
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
  viewport.append(refImg, ruler);
  el.appendChild(viewport);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(3.2, 1.8, 4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.4, 0);

  const kart = new THREE.Group();
  scene.add(kart);
  const grid = new THREE.GridHelper(10, 20, 0x556070, 0x30363f);
  let boxHelper: THREE.Box3Helper | null = null;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  // Mutable view state.
  let variantId: KartVariantId = KART_VARIANTS[0]!.id;
  let colorwayId: KartColorwayId = KART_COLORWAYS[0]!.id;
  let dims: KartDimensions = measureKart(variantId);
  let showBox = false;
  let showGrid = true;
  let objectUrl: string | null = null;
  let realMeters = 0;

  scene.add(grid);

  function sizeOf(): { w: number; h: number } {
    const rect = el.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1;
    const h = rect.height || window.innerHeight || 1;
    return { w, h };
  }

  function resize(): void {
    const { w, h } = sizeOf();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    const shown = objectUrl !== null && pxPerM > 0;
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
    scene.add(grid);
    buildKartVisual(kart, variantId, colorwayById(colorwayId).colors);
    applyStudioLight(kart);
    updateMeasurements();
    refreshBox();
    updateRuler();
  }

  // Reference image load/replace/clear (runtime-only object URLs).
  function loadReference(file: File): void {
    if (!file.type.startsWith("image/")) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    refImg.src = objectUrl;
    refImg.style.display = "block";
  }

  function clearReference(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    refImg.removeAttribute("src");
    refImg.style.display = "none";
    updateRuler();
  }

  // Controls panel.
  const panel = document.createElement("div");
  panel.style.cssText = PANEL;
  const title = document.createElement("strong");
  title.textContent = "GARAGE";
  panel.appendChild(title);

  const variantSel = select(KART_VARIANTS.map((v) => ({ id: v.id, name: v.name })));
  variantSel.value = variantId;
  const onVariant = (): void => {
    variantId = variantSel.value as KartVariantId;
    rebuildKart();
  };
  variantSel.addEventListener("change", onVariant);
  panel.appendChild(labelRow("chassis", variantSel));

  const colorSel = select(KART_COLORWAYS.map((c) => ({ id: c.id, name: c.name })));
  colorSel.value = colorwayId;
  const onColor = (): void => {
    colorwayId = colorSel.value as KartColorwayId;
    rebuildKart();
  };
  colorSel.addEventListener("change", onColor);
  panel.appendChild(labelRow("paint", colorSel));

  panel.appendChild(readout);

  const boxToggle = document.createElement("input");
  boxToggle.type = "checkbox";
  const onBox = (): void => {
    showBox = boxToggle.checked;
    refreshBox();
  };
  boxToggle.addEventListener("change", onBox);
  panel.appendChild(labelRow("bounds box", boxToggle));

  const gridToggle = document.createElement("input");
  gridToggle.type = "checkbox";
  gridToggle.checked = showGrid;
  const onGrid = (): void => {
    showGrid = gridToggle.checked;
    grid.visible = showGrid;
  };
  gridToggle.addEventListener("change", onGrid);
  panel.appendChild(labelRow("ground grid", gridToggle));

  // Reference overlay controls.
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.cssText = "width:150px;color:#cfd2d8";
  const onFile = (): void => {
    const f = fileInput.files?.[0];
    if (f) loadReference(f);
  };
  fileInput.addEventListener("change", onFile);
  panel.appendChild(labelRow("reference", fileInput));

  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.min = "0";
  opacity.max = "1";
  opacity.step = "0.05";
  opacity.value = "0.5";
  const onOpacity = (): void => {
    refImg.style.opacity = opacity.value;
  };
  opacity.addEventListener("input", onOpacity);
  panel.appendChild(labelRow("opacity", opacity));

  const meters = document.createElement("input");
  meters.type = "number";
  meters.min = "0";
  meters.step = "0.1";
  meters.placeholder = "ref width m";
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

  let raf = requestAnimationFrame(function frame(): void {
    raf = requestAnimationFrame(frame);
    controls.update();
    composer.render();
  });

  return {
    el,
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
