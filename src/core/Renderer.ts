import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "../materials/lightUniforms";
import { PostOutlinePass } from "../materials/postOutline";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { applyDayCycleToTargets, dayCycleState } from "../environment/dayCycle";
import type { DayCycleLightTargets } from "../environment/dayCycle";

/**
 * Axis-aligned rectangle in the drawing buffer, in CSS pixels, using the
 * WebGL bottom-left origin (y=0 at the bottom). renderViews maps one
 * ViewDescriptor per rect. splitRects tiles a buffer into equal rects.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One rendered view: a camera + the screen rect it draws into. */
export interface ViewDescriptor {
  camera: THREE.Camera;
  rect: Rect;
}

/**
 * Tile a w x h buffer into n equal rects along an axis. Deterministic + pure.
 * 'horizontal' stacks rows (top/bottom split); 'vertical' side-by-side. WebGL
 * bottom-origin: for a horizontal 2-split, index 0 is the TOP half (highest y)
 * so P1 (index 0) renders on top, P2 on the bottom. n<=1 -> one full rect.
 */
export function splitRects(
  w: number,
  h: number,
  axis: "horizontal" | "vertical",
  n: number,
): Rect[] {
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  const rects: Rect[] = [];
  if (axis === "horizontal") {
    const rowH = h / n;
    for (let i = 0; i < n; i++) {
      rects.push({ x: 0, y: h - (i + 1) * rowH, w, h: rowH });
    }
  } else {
    const colW = w / n;
    for (let i = 0; i < n; i++) {
      rects.push({ x: i * colW, y: 0, w: colW, h });
    }
  }
  return rects;
}

interface ComposerSlot {
  composer: EffectComposer;
  renderPass: RenderPass;
  postOutline: PostOutlinePass;
  skyPosterize: SkyPosterizePass;
  /** Current RT size (CSS px); ensureSlot resizes when this changes. */
  w: number;
  h: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: Sky;
  /** One composer per view slot, built lazily + resized to its rect. */
  private slots: ComposerSlot[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Multi-view (008) draws N fullscreen-triangle composites per frame, one
    // per viewport; autoClear would erase the previous view's half before the
    // next draws. The composite fully overwrites its rect, so no clear needed.
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Sky mesh replaces the flat background; fog blends distant terrain into
    // the horizon sky band tint so the seam reads as continuous haze.
    // #b6ad9e matches the lowest visible Ghibli sky band (slate warm gray).
    const fog = new THREE.Fog(0xb6ad9e, 90, 360);
    this.scene.fog = fog;

    // Single source of truth for the sun direction lives in lightUniforms
    // (world space). Sky sunPosition, DirectionalLight position, and the
    // shadow target all read from it so the visible disc and shadow vector
    // can never drift.
    const sunDirWorld = lightUniforms.uSunDirWorld.value;

    // Procedural Preetham atmosphere sky dome. Lives on layer 2 so the
    // Sobel outline pass (layer 1 only) and the sky-posterize depth mask
    // (layers 0+1) both cleanly exclude it.
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.layers.set(2);
    const u = this.sky.material.uniforms;
    u["turbidity"].value = 8;
    u["rayleigh"].value = 1.6;
    u["mieCoefficient"].value = 0.005;
    u["mieDirectionalG"].value = 0.8;
    u["sunPosition"].value.copy(sunDirWorld);
    this.scene.add(this.sky);

    this.ambient = new THREE.HemisphereLight(0xb8e0ff, 0x80905a, 1.0);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xffe8b0, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    const s = 80;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.setShadowTarget(0, 0);

    // Bind the pure day-cycle helper to the live Three objects so its in-place
    // copies land in the real sun/ambient lights, scene.fog, and the shared
    // lightUniforms.uSunDirWorld each frame.
    this._dayCycleTargets = {
      sunColor: this.sun.color,
      ambientColor: this.ambient.color,
      fogColor: fog.color,
      fog,
      sunDirWorld: lightUniforms.uSunDirWorld.value,
      skyZenith: this._skyScratchZenith,
      skyHorizon: this._skyScratchHorizon,
    };
  }

  setShadowTarget(x: number, z: number): void {
    // Place the light along the shared sun direction (relative to the kart)
    // so shadows stay aligned with the visible sun as the target follows
    // the kart.
    const d = 160;
    const sunDirWorld = lightUniforms.uSunDirWorld.value;
    sunWorldPosition(sunDirWorld, this.sun.position, d);
    this.sun.position.x += x;
    this.sun.position.z += z;
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    // Per-slot composers resize lazily inside renderViews (their size depends
    // on the view rect, which the caller computes from the new w/h).
  }

  /** Single-view shorthand: one full-screen view. */
  render(camera: THREE.Camera): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderViews([{ camera, rect: { x: 0, y: 0, w: size.width, h: size.height } }]);
  }

  /**
   * Render N views, one per slot, each into its own viewport via scissor +
   * viewport. Each slot owns an EffectComposer sized to its rect (built lazily,
   * resized when the rect changes). Per view: rebind the active camera on every
   * pass (006 menu/chase swap; 008 per-player chase cam), enable layers 1+2,
   * refresh shared light uniforms for that camera, then composer.render(). The
   * final renderToScreen composite respects the renderer viewport (three sets
   * _viewport from setRenderTarget(null)), so each view lands in its rect.
   */
  renderViews(views: ViewDescriptor[]): void {
    this.applyDayCycle();
    this.renderer.setScissorTest(true);
    for (let i = 0; i < views.length; i++) {
      const { camera, rect } = views[i]!;
      const slot = this.ensureSlot(i, rect.w, rect.h);
      this.renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      this.renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      slot.renderPass.camera = camera;
      slot.postOutline.camera = camera;
      slot.skyPosterize.camera = camera;
      camera.layers.enable(1);
      camera.layers.enable(2);
      camera.updateMatrixWorld();
      this.updateLightUniformsFor(camera);
      slot.composer.render();
    }
  }

  /** Build (if missing) or resize (if rect changed) the composer for slot i. */
  private ensureSlot(i: number, w: number, h: number): ComposerSlot {
    const existing = this.slots[i];
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) {
      existing.composer.setSize(w, h);
      existing.w = w;
      existing.h = h;
      return existing;
    }
    const slot = this.buildSlot(w, h);
    this.slots[i] = slot;
    return slot;
  }

  /**
   * Build the EffectComposer for one slot: RenderPass renders the full scene
   * LINEAR into a HalfFloat buffer (materials skip tone mapping while
   * currentRenderTarget != null), PostOutlinePass composites terrain Sobel
   * edges, OutputPass applies ACES tone mapping + sRGB, then SkyPosterizePass
   * snaps sky pixels to ~4 painted bands (Ghibli). Single tone-mapping pass,
   * no double ACES; posterize runs post-tonemap sRGB. Sized to the slot rect.
   */
  private buildSlot(w: number, h: number): ComposerSlot {
    // Camera is rebound every frame; a placeholder suffices for construction.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, cam);
    composer.addPass(renderPass);
    const postOutline = new PostOutlinePass(this.scene, cam, w, h);
    composer.addPass(postOutline);
    composer.addPass(new OutputPass());
    const skyPosterize = new SkyPosterizePass(this.scene, cam, w, h);
    composer.addPass(skyPosterize);
    composer.setSize(w, h);
    return { composer, renderPass, postOutline, skyPosterize, w, h };
  }

  /**
   * Forward the shared {@link dayCycleState} into the scene's lights, Sky,
   * fog, and sky-posterize slots once per frame. Light tints + fog color/near/
   * far + sun direction go through the pure {@link applyDayCycleToTargets}
   * helper (mutates the live Three objects via {@link _dayCycleTargets}); the
   * scalar intensities, hemisphere ground tint, Sky sunPosition, and the
   * per-slot zenith/horizon fan-out do not fit the helper's single-target
   * shape and are applied here. Camera-independent, so called once at the top
   * of {@link renderViews} rather than per view.
   */
  private applyDayCycle(): void {
    const state = dayCycleState;
    applyDayCycleToTargets(state, this._dayCycleTargets);

    // Intensity scalars + a darker ground shade of the ambient sky tint, so
    // the hemisphere floor darkens with the night ambient.
    this.sun.intensity = state.sunIntensity;
    this.ambient.intensity = state.ambientIntensity;
    this.ambient.groundColor.copy(state.ambientColor).multiplyScalar(0.5);

    // Sky sun disc direction (separate Vector3 from lightUniforms.uSunDirWorld;
    // the helper already updated the shared sun dir uniform above).
    (this.sky.material.uniforms["sunPosition"].value as THREE.Vector3).copy(state.sunDirWorld);

    // Fan the zenith/horizon tints out to every already-built slot's posterize
    // pass. Slots are built lazily inside renderViews, so the first frame's
    // new slots render one frame with their ctor defaults before being driven.
    for (const slot of this.slots) {
      slot.skyPosterize.skyZenith.copy(this._skyScratchZenith);
      slot.skyPosterize.skyHorizon.copy(this._skyScratchHorizon);
    }
  }

  private updateLightUniformsFor(camera: THREE.Camera): void {
    updateLightUniforms(
      lightUniforms,
      lightUniforms.uSunDirWorld.value,
      this._sunColorLinear.copy(this.sun.color).multiplyScalar(this.sun.intensity),
      this._ambientLinear
        .copy(this.ambient.color)
        .lerp(this.ambient.groundColor, 0.5)
        .multiplyScalar(this.ambient.intensity),
      camera.matrixWorldInverse,
    );
  }

  private readonly _sunColorLinear = new THREE.Color();
  private readonly _ambientLinear = new THREE.Color();
  /**
   * Live Three objects {@link applyDayCycleToTargets} mutates each frame.
   * Built once in the ctor so in-place copies land in the real lights/fog +
   * lightUniforms.uSunDirWorld; the zenith/horizon refs are scratch the
   * per-slot fan-out reads (slots are built lazily, so they cannot be bound
   * here).
   */
  private readonly _dayCycleTargets: DayCycleLightTargets;
  private readonly _skyScratchZenith = new THREE.Color();
  private readonly _skyScratchHorizon = new THREE.Color();

  dispose(): void {
    for (const slot of this.slots) {
      slot.postOutline.dispose();
      slot.skyPosterize.dispose();
      slot.composer.dispose();
    }
    this.slots = [];
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
