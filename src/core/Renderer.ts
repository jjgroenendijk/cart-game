import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "../materials/lightUniforms";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { applyPostGradeToPass, computePostGrade } from "../materials/postGrade";
import { applyDayCycleToTargets, dayCycleState } from "../environment/dayCycle";
import type { DayCycleLightTargets } from "../environment/dayCycle";
import { DEFAULT_QUALITY, qualityKnobs } from "./quality";
import type { QualityKnobs, QualityTier } from "./quality";
import {
  applyKartLodGroup,
  kartLod,
  nearestCameraDistance,
  type KartLodLevel,
  type Pt,
} from "../kart/kartLod";
import type { Terrain } from "../terrain/Terrain";

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
 * Accumulated renderer.info totals for one whole game frame, sampled once
 * after renderViews. render counters (calls/triangles/lines/points) sum
 * across every WebGLRenderer.render() call in the frame: all views and
 * every composer pass (RenderPass, OutputPass, SkyPosterizePass). memory
 * counters (geometries/textures) are live
 * GL-resource totals, not per-frame deltas. Built with autoReset off and
 * a single reset() at frame start so three.js accumulates instead of
 * overwriting on each pass.
 */
export interface FrameStats {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
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

/**
 * Whether the directional shadow map should render for a given shadowFade.
 * The map stays alive across the whole fade band (no teardown/recompile
 * mid-transition) and is dropped only at fade 0 (deep night), where the
 * cel shader recompiles to the shadowless path in the dark. Pure so it
 * is unit-testable under jsdom (Renderer itself needs WebGL).
 */
export function shadowCastsFromFade(shadowFade: number): boolean {
  return shadowFade > 0;
}

interface ComposerSlot {
  composer: EffectComposer;
  renderPass: RenderPass;
  skyPosterize: SkyPosterizePass;
  /** Current RT size (CSS px); ensureSlot resizes when this changes. */
  w: number;
  h: number;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /** Set by Game; source of the per-frame terrain LOD pass when non-null. */
  terrain: Terrain | null = null;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: Sky;
  /** One composer per view slot, built lazily + resized to its rect. */
  private slots: ComposerSlot[] = [];
  /** Current quality tier; null until the first setQuality() applies one. */
  private quality: QualityTier | null = null;
  /**
   * Master post-grade + vignette strength scalar from the active tier's
   * knobs (1 = full look, 0 = pre-064 identity). Near-free ALU, full on
   * every tier.
   */
  private postGradeStrength = 1;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    // pixelRatio is applied by setQuality(DEFAULT_QUALITY) below, after the
    // sun + shadow camera exist (it owns pixelRatio + all shadow extents).
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Multi-view (008) draws N fullscreen-triangle composites per frame, one
    // per viewport; autoClear would erase the previous view's half before the
    // next draws. The composite fully overwrites its rect, so no clear needed.
    this.renderer.autoClear = false;
    // Accumulate render counters across every internal render() call this
    // frame (one per composer pass, per view) instead of letting each
    // render() overwrite. renderViews resets once at frame start so the
    // post-render snapshot holds the true per-frame total.
    this.renderer.info.autoReset = false;
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
    // sky-posterize depth mask (layers 0+1) cleanly excludes it.
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.layers.set(2);
    // Dome is placed once and never moves; sun motion is a material
    // uniform, not a transform -> freeze the world matrix once here.
    this.sky.matrixAutoUpdate = false;
    this.sky.updateMatrix();
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
    // Tier-independent shadow bits stay here; mapSize + far + ortho extents
    // are owned by setQuality (they scale with the quality tier). normalBias
    // pushes the shadow depth sample along the surface normal to kill
    // self-shadow acne on the large terrain/prop faces; radius spreads the
    // PCF (SHADOWMAP_TYPE_PCF) samples for a softer penumbra.
    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.radius = 3.0;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.setQuality(DEFAULT_QUALITY);
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

  /**
   * Apply a quality tier's pixelRatio + shadow extents to the renderer and
   * sun shadow camera, then rebuild the shadow map so the new mapSize takes
   * effect immediately. Tier-independent bits (castShadow, camera.near,
   * shadow.bias) stay in the constructor; everything that scales with quality
   * lives here. The default tier "high" reproduces the pre-011 hardcoded
   * look; 012 will wire user choice to this entry point. No-op if the tier
   * is unchanged since the last call (the first ctor call always applies
   * because quality starts null).
   */
  setQuality(tier: QualityTier): void {
    if (this.quality === tier) return;
    const k: QualityKnobs = qualityKnobs(tier, window.devicePixelRatio);
    this.renderer.setPixelRatio(k.pixelRatio);
    this.sun.shadow.mapSize.set(k.shadowMapSize, k.shadowMapSize);
    this.sun.shadow.camera.far = k.shadowCameraFar;
    const h = k.shadowHalfExtent;
    this.sun.shadow.camera.left = -h;
    this.sun.shadow.camera.right = h;
    this.sun.shadow.camera.top = h;
    this.sun.shadow.camera.bottom = -h;
    this.sun.shadow.camera.updateProjectionMatrix();
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.needsUpdate = true;
    this.postGradeStrength = k.postGradeStrength;
    this.quality = tier;
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

  /** Single-view shorthand: one full-screen view. Forwards `racing` to
   * {@link renderViews} so callers can gate the mask passes on menu frames. */
  render(camera: THREE.Camera, racing = true): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderViews([{ camera, rect: { x: 0, y: 0, w: size.width, h: size.height } }], racing);
  }

  /**
   * Render N views, one per slot, each into its own viewport via scissor +
   * viewport. Each slot owns an EffectComposer sized to its rect (built lazily,
   * resized when the rect changes). Per view: rebind the active camera on every
   * pass (006 menu/chase swap; 008 per-player chase cam), enable layers 1+2,
   * refresh shared light uniforms for that camera, then composer.render(). The
   * final renderToScreen composite respects the renderer viewport (three sets
   * _viewport from setRenderTarget(null)), so each view lands in its rect.
   *
   * When `racing` is false (menu/select/countdown/paused) the SkyPosterize
   * mask pass is disabled: the scene is static or camera-only, so
   * re-rendering it for sky cel bands is wasted work. RenderPass +
   * OutputPass still emit a correct visible image; SkyPosterize re-enables
   * on the first racing frame.
   */
  renderViews(views: ViewDescriptor[], racing = true): void {
    this.renderer.info.reset();
    this.applyDayCycle();
    // Build the camera-position list ONCE; both LOD passes read it read-only.
    const cams = this.cameraPositions(views);
    this.applyKartLod(cams);
    this.applyTerrainLod(cams);
    this.renderer.setScissorTest(true);
    for (let i = 0; i < views.length; i++) {
      const { camera, rect } = views[i]!;
      const slot = this.ensureSlot(i, rect.w, rect.h);
      this.renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      this.renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      slot.renderPass.camera = camera;
      slot.skyPosterize.camera = camera;
      slot.skyPosterize.enabled = racing;
      camera.layers.enable(1);
      camera.layers.enable(2);
      camera.updateMatrixWorld();
      this.updateLightUniformsFor(camera);
      slot.composer.render();
    }
    this.snapshotFrameStats();
  }

  /**
   * Frame-accumulated renderer.info for the last completed frame: render
   * counters (calls/triangles/lines/points) summed across every pass of
   * every view, memory counters live. Read-only snapshot; callers read it
   * immediately (StatsHud samples it from its own rAF).
   */
  getFrameStats(): FrameStats {
    return this._lastFrameStats;
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
   * currentRenderTarget != null), OutputPass applies ACES tone mapping +
   * sRGB, then SkyPosterizePass snaps sky pixels to ~4 painted bands
   * (Ghibli). Single tone-mapping pass, no double ACES; posterize runs
   * post-tonemap sRGB. Sized to the slot rect.
   */
  private buildSlot(w: number, h: number): ComposerSlot {
    // Camera is rebound every frame; a placeholder suffices for construction.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, cam);
    composer.addPass(renderPass);
    composer.addPass(new OutputPass());
    const skyPosterize = new SkyPosterizePass(this.scene, cam, w, h);
    composer.addPass(skyPosterize);
    composer.setSize(w, h);
    return { composer, renderPass, skyPosterize, w, h };
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

    // Cast shadows fade with elevation (dayCycle.shadowFade, 0 below 3 deg,
    // 1 above 18 deg). Drive the cel shadow-term intensity via uShadowFade and
    // keep the shadow map rendering across the whole band (no teardown/recompile
    // mid-transition); drop castShadow only at fade 0 (deep night) so the cel
    // shader recompiles to the shadowless path in the dark.
    lightUniforms.uShadowFade.value = state.shadowFade;
    this.sun.castShadow = shadowCastsFromFade(state.shadowFade);

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
    // 064: phase-mixed grade + vignette, resolved once per frame and fanned to
    // every slot (same shape as the zenith/horizon fan-out). Camera-independent.
    const postGrade = computePostGrade(state.cycleT, this.postGradeStrength);
    for (const slot of this.slots) {
      slot.skyPosterize.skyZenith.copy(this._skyScratchZenith);
      slot.skyPosterize.skyHorizon.copy(this._skyScratchHorizon);
      applyPostGradeToPass(slot.skyPosterize, postGrade);
    }
  }

  /**
   * Per-frame distance-based LOD pass for every kart in the scene. Gathers the
   * active cameras' world positions (built once in {@link renderViews} via
   * {@link cameraPositions}), then for each scene child tagged
   * userData.role === "kart" resolves the LOD level from the NEAREST camera
   * distance + the previous frame's level (hysteresis) and applies it in place.
   * Runs before the per-view render loop so every view sees the same LOD state.
   *
   * Skip the per-kart child-graph traverse when the resolved level matches the
   * cached prev (child.userData.lod). The flags rarely change frame-to-frame,
   * so this avoids walking ~15+ meshes per kart every frame. First frame (or a
   * freshly added kart) has prev undefined; since kartLod always returns a
   * concrete level, the equality check fails and the first apply always runs.
   */
  private applyKartLod(cams: readonly Pt[]): void {
    for (const child of this.scene.children) {
      if (child.userData?.role !== "kart") continue;
      const d = nearestCameraDistance(child.position, cams);
      const prev = child.userData.lod as KartLodLevel | undefined;
      const res = kartLod(d, prev);
      if (res.level === prev) continue;
      applyKartLodGroup(child, res);
    }
  }

  /**
   * Per-frame terrain LOD pass over the active cameras (1P/2P), mirroring
   * {@link applyKartLod}. No-op until Game sets {@link terrain}.
   */
  private applyTerrainLod(cams: readonly Pt[]): void {
    if (!this.terrain) return;
    this.terrain.update(cams);
  }

  /**
   * Fill the pooled camera-position Pt[] from the active views' cameras. Grows
   * the pool when the view count rises (1P -> 2P) + truncates when it shrinks.
   * Reused across frames so the LOD passes allocate zero objects at steady
   * state. Both {@link applyKartLod} + {@link applyTerrainLod} read it
   * read-only.
   */
  private cameraPositions(views: ViewDescriptor[]): Pt[] {
    const n = views.length;
    while (this._camPos.length < n) this._camPos.push({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < n; i++) {
      const c = views[i]!.camera.position;
      const p = this._camPos[i]!;
      p.x = c.x;
      p.y = c.y;
      p.z = c.z;
    }
    this._camPos.length = n;
    return this._camPos;
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

  /**
   * Copy the frame-accumulated renderer.info into {@link _lastFrameStats}.
   * With autoReset off, render counters carry the per-frame sum across
   * every pass of every view (reset once at the top of renderViews);
   * memory counters are the live GL-resource totals.
   */
  private snapshotFrameStats(): void {
    const info = this.renderer.info;
    const r = info.render;
    const m = info.memory;
    const s = this._lastFrameStats;
    s.calls = r.calls;
    s.triangles = r.triangles;
    s.lines = r.lines;
    s.points = r.points;
    s.geometries = m.geometries;
    s.textures = m.textures;
    s.programs = info.programs?.length ?? 0;
  }

  private readonly _sunColorLinear = new THREE.Color();
  private readonly _ambientLinear = new THREE.Color();
  /** Pooled camera-position Pt[] reused by both LOD passes (grown/truncated). */
  private readonly _camPos: Pt[] = [];
  /**
   * Frame-accumulated renderer.info written by {@link snapshotFrameStats}
   * and exposed via {@link getFrameStats}. Reused across frames (no
   * per-frame alloc); callers read it immediately.
   */
  private readonly _lastFrameStats: FrameStats = {
    calls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  };
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
