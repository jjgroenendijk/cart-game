/**
 * WebGL/DOM/three chrome + studio light for the dev garage viewer
 * (src/dev/Garage.ts). Split out of Garage.ts to hold that file under the
 * hand-written line cap. `buildGarageChrome()` owns the renderer try/catch
 * (returns null without WebGL, so createGarage's null guard holds), the root
 * DOM tree (el/viewport/ref/ruler/svg/compareImg), and the three scene graph
 * objects (scene/cameras/controls/composer/kart/grid); it returns the full set
 * createGarage's closures mutate. Matches the garage*.ts sibling pattern.
 */

import * as THREE from "three";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SVG_NS } from "./garageSvg";

/** Fixed studio light in the garage camera's view space (mirrors KartPreview). */
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.6).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9);
const AMBIENT = new THREE.Color(0.4, 0.42, 0.48);

/** Swap in garage-local light uniform objects on every cel material. */
export function applyStudioLight(root: THREE.Object3D): void {
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

/** The full chrome set createGarage's closures capture + mutate. */
export interface GarageChrome {
  renderer: THREE.WebGLRenderer;
  el: HTMLDivElement;
  viewport: HTMLDivElement;
  refImg: HTMLImageElement;
  ruler: HTMLDivElement;
  rulerTag: HTMLSpanElement;
  svg: SVGSVGElement;
  compareImg: HTMLImageElement;
  scene: THREE.Scene;
  orthoCam: THREE.OrthographicCamera;
  isoCam: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  renderPass: RenderPass;
  kart: THREE.Group;
  grid: THREE.GridHelper;
}

/**
 * Build the garage renderer + DOM root + scene graph, or null when a WebGL
 * context can't be created (the guard runs before any DOM is committed beyond
 * the renderer, so jsdom returns cleanly). The active camera + boxHelper stay
 * in createGarage (they are reassigned by closures); everything the closures
 * capture by reference is returned here.
 */
export function buildGarageChrome(): GarageChrome | null {
  let renderer: THREE.WebGLRenderer;
  try {
    // preserveDrawingBuffer lets compare mode read back pixels via drawImage of
    // the GL canvas synchronously (silhouette + shaded passes) without a compositor.
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
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
  const controls = new OrbitControls(isoCam, renderer.domElement);
  controls.enableDamping = true;

  const kart = new THREE.Group();
  scene.add(kart);
  const grid = new THREE.GridHelper(10, 20, 0x556070, 0x30363f);
  scene.add(grid);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  const renderPass = new RenderPass(scene, isoCam);
  composer.addPass(renderPass);
  composer.addPass(
    new EffectPass(isoCam, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })),
  );

  return {
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
  };
}
