/**
 * Live 3D kart preview for the select overlay (083). A small transparent
 * WebGL canvas with a slowly turning kart built by the shared
 * buildKartVisual, so the preview shows exactly the racing mesh. Owns a
 * private renderer + composer (RenderPass -> OutputPass, mirroring the
 * game's ACES/sRGB output) and overrides each cel material's light
 * uniforms with fixed studio values — the shared lightUniforms live in the
 * MAIN camera's view space and track the day cycle, which would light the
 * preview from arbitrary directions.
 *
 * createKartPreview returns null where WebGL is unavailable (jsdom); the
 * overlay renders without a preview then, so tests and headless runs keep
 * working. The overlay owns the lifecycle: setStyle on cursor change,
 * start/stop with show/hide, dispose on remove.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildKartVisual, disposeKartVisual } from "../kart/kartVisual";
import { colorwayById } from "../kart/kartColorways";
import type { KartPick } from "../core/kartSelection";

export interface KartPreviewHandle {
  /** Container element the overlay inserts into its stack. */
  readonly el: HTMLElement;
  /** Rebuild the displayed kart (no-op when the pick is unchanged). */
  setStyle(pick: KartPick): void;
  /** Begin the turntable render loop (idempotent). */
  start(): void;
  /** Halt the render loop (idempotent). */
  stop(): void;
  /** Stop, free GL resources, detach the element. */
  dispose(): void;
}

export type KartPreviewFactory = () => KartPreviewHandle | null;

const WIDTH = 340;
const HEIGHT = 200;
/** Fixed studio light in the PREVIEW camera's view space. */
const SUN_DIR = new THREE.Vector3(0.55, 0.75, 0.6).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9);
const AMBIENT = new THREE.Color(0.4, 0.42, 0.48);
/** Turntable speed (rad/s). */
const SPIN = 0.6;

/** Swap in preview-local light uniform objects on every cel material. */
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

/** Build a preview handle, or null when a WebGL context can't be created. */
export function createKartPreview(): KartPreviewHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const el = document.createElement("div");
  el.className = "gc-kart-preview";
  el.style.cssText = ["width:340px", "height:200px", "max-width:80vw", "pointer-events:none"].join(
    ";",
  );
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(2.7, 1.4, 3.4);
  camera.lookAt(0, -0.05, 0);

  // Turntable holder; the kart group is rebuilt inside it on setStyle.
  const holder = new THREE.Group();
  scene.add(holder);
  const kart = new THREE.Group();
  holder.add(kart);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  let shown = "";
  let raf = 0;
  let prev = 0;

  const frame = (t: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = prev === 0 ? 0 : Math.min((t - prev) / 1000, 0.1);
    prev = t;
    holder.rotation.y += dt * SPIN;
    composer.render();
  };

  return {
    el,
    setStyle(pick: KartPick): void {
      const key = `${pick.variant}/${pick.colorway}`;
      if (key === shown) return;
      shown = key;
      disposeKartVisual(kart);
      kart.clear();
      buildKartVisual(kart, pick.variant, colorwayById(pick.colorway).colors);
      applyStudioLight(kart);
      // Paint at least one frame even while stopped (e.g. built pre-show).
      composer.render();
    },
    start(): void {
      if (raf !== 0) return;
      prev = 0;
      raf = requestAnimationFrame(frame);
    },
    stop(): void {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    },
    dispose(): void {
      this.stop();
      disposeKartVisual(kart);
      kart.clear();
      composer.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
