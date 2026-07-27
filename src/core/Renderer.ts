import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "../materials/lightUniforms";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { DepthCapturePass } from "../materials/depthCapture";
import { applyPostGradeToPass, computePostGrade } from "../materials/postGrade";
import { glowIntensity } from "../materials/sunGlow";
import { applySunEffects, type SunFxConfig } from "../materials/sunEffects";
import { GroundMistPass } from "../materials/groundMist";
import { mistTimeFactor } from "../materials/groundMistMath";
import { wetnessUniform } from "../materials/cel";
import { applyDayCycleToTargets, dayCycleState } from "../environment/dayCycle";
import type { DayCycleLightTargets } from "../environment/dayCycle";
import { DEFAULT_QUALITY, qualityKnobs } from "./quality";
import type { QualityKnobs, QualityTier } from "./quality";
import type { EffectSettings } from "./settings";
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
 * after renderViews. render counters sum across every WebGLRenderer.render()
 * call (all views + every composer pass); memory counters are live totals.
 * autoReset off + one reset() at frame start so three accumulates.
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
 * bottom-origin: for a horizontal 2-split, index 0 is the TOP half so P1 renders
 * on top, P2 on the bottom. n<=1 -> one full rect.
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
 * Whether the directional shadow map should render for a given shadowFade. The
 * map stays alive across the whole fade band (no teardown/recompile mid-
 * transition) and is dropped only at fade 0 (deep night), where the cel shader
 * recompiles to the shadowless path. Pure so it is unit-testable under jsdom.
 */
export function shadowCastsFromFade(shadowFade: number): boolean {
  return shadowFade > 0;
}

/**
 * Fraction of the world half-extent the fog-far plane is capped to, so distant
 * terrain fully hazes out at (or just before) the bounded world boundary
 * instead of ending in a hard edge against the sky. margin 1.0 places the fog
 * end exactly at the boundary (linear fog -> fully saturated there); lower
 * values hide a ring of edge terrain.
 */
export const FOG_EDGE_MARGIN = 1.0;

/**
 * Cap linear-fog near/far to the bounded world so terrain dissolves into haze
 * before its edge. Only shrinks the range when far exceeds the world cap; larger
 * worlds keep their day-cycle fog untouched. near scales by the same factor to
 * preserve the gradient shape. worldHalfExtent = Infinity (unset) is a
 * passthrough. Pure so it is unit-testable under jsdom.
 */
export function scaleFogToWorld(
  near: number,
  far: number,
  worldHalfExtent: number,
  margin = FOG_EDGE_MARGIN,
): { near: number; far: number } {
  const cap = worldHalfExtent * margin;
  if (!(far > cap)) return { near, far };
  const s = cap / far;
  return { near: near * s, far: cap };
}

interface ComposerSlot {
  composer: EffectComposer;
  renderPass: RenderPass;
  /** Shared layers-0+1 depth capture; its DepthTexture feeds skyPosterize. */
  depthCapture: DepthCapturePass;
  skyPosterize: SkyPosterizePass;
  /** 228 valley ground-mist pass; camera rebound per view. */
  groundMist: GroundMistPass;
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
  /**
   * Half-width of the bounded terrain square (Game sets it on field build).
   * Caps the per-frame fog-far plane via {@link scaleFogToWorld} so distant
   * terrain hazes out at the world boundary. Infinity (default) = no clamp.
   */
  worldHalfExtent = Infinity;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: Sky;
  /** One composer per view slot, built lazily + resized to its rect. */
  private slots: ComposerSlot[] = [];
  /** Current quality tier; null until the first setQuality() applies one. */
  private quality: QualityTier | null = null;
  /**
   * Master post-grade + vignette strength scalar from the active tier's knobs
   * (1 = full look, 0 = pre-064 identity). Near-free ALU, full on every tier.
   */
  private postGradeStrength = 1;
  // 228: tier-resolved ground-mist master gain (0 = identity/off).
  private groundMistStrength = 1;
  // 159 sun-effect state: user enables (default off until Game applies
  // settings) + this tier's max strengths, consumed per view by
  // applySunEffects. _fxGlow + _sunColorSrgb are resolved once per frame.
  private readonly _fxConfig: SunFxConfig = {
    enables: { sunHalo: false, godRays: false, lensFlare: false, groundMist: true },
    strengths: { halo: 0, godray: 0, flare: 0 },
  };
  private _fxGlow = 0;
  private readonly _sunColorSrgb = new THREE.Color();
  // 228: scratch sRGB fog tint reused across frames (no per-frame alloc).
  private readonly _mistFogSrgb = new THREE.Color();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    // pixelRatio is applied by setQuality(DEFAULT_QUALITY) below (it owns
    // pixelRatio + all shadow extents), after the sun + shadow camera exist.
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Multi-view (008) draws N composites per frame, one per viewport; autoClear
    // would erase a prior view's half. Each composite fully overwrites its rect.
    this.renderer.autoClear = false;
    // Accumulate render counters across every internal render() call this frame
    // (one per composer pass, per view); renderViews resets once at frame start.
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
    // (world space); Sky/DirectionalLight/shadow target all read from it.
    const sunDirWorld = lightUniforms.uSunDirWorld.value;

    // Procedural Preetham atmosphere sky dome. Lives on layer 2 so the
    // sky-posterize depth mask (layers 0+1) cleanly excludes it.
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.layers.set(2);
    // Dome never moves; sun motion is a uniform, not a transform -> freeze once.
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
    // are owned by setQuality. normalBias kills self-shadow acne on the large
    // terrain/prop faces; radius spreads the PCF samples for a softer penumbra.
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
   * Apply a quality tier's pixelRatio + shadow extents + strengths, then
   * rebuild the shadow map so the new mapSize takes effect immediately.
   * Tier-independent bits stay in the constructor. "high" reproduces the
   * pre-011 look. No-op if the tier is unchanged (first ctor call always
   * applies; quality starts null).
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
    this._fxConfig.strengths.halo = k.sunHaloStrength;
    this._fxConfig.strengths.godray = k.godRayStrength;
    this._fxConfig.strengths.flare = k.lensFlareStrength;
    this.groundMistStrength = k.groundMistStrength;
    this.quality = tier;
  }

  /**
   * 159: set the per-effect enables (from Settings). Copied so later settings
   * mutations do not leak in. Gains reach the pass on the next frame; when all
   * are off (or the sun is down) the pass stays a byte-identical no-op.
   */
  setEffects(effects: EffectSettings): void {
    this._fxConfig.enables.sunHalo = effects.sunHalo;
    this._fxConfig.enables.godRays = effects.godRays;
    this._fxConfig.enables.lensFlare = effects.lensFlare;
    this._fxConfig.enables.groundMist = effects.groundMist;
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
    // Per-slot composers resize lazily inside renderViews (size = the view rect).
  }

  /** Single-view shorthand: one full-screen view. */
  render(camera: THREE.Camera): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderViews([{ camera, rect: { x: 0, y: 0, w: size.width, h: size.height } }]);
  }

  /**
   * Render N views, one per slot, each into its own viewport via scissor +
   * viewport. Each slot owns an EffectComposer sized to its rect. Per view:
   * rebind the active camera on every pass (006 menu/chase swap; 008 per-player
   * chase cam), enable layers 1+2, refresh light + sun-effect uniforms, then
   * composer.render(). SkyPosterize runs in every state so menu/countdown/paused
   * share the gameplay backdrop instead of a white sky.
   */
  renderViews(views: ViewDescriptor[]): void {
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
      slot.depthCapture.camera = camera;
      slot.groundMist.camera = camera;
      slot.skyPosterize.enabled = true;
      camera.layers.enable(1);
      camera.layers.enable(2);
      camera.updateMatrixWorld();
      this.updateLightUniformsFor(camera);
      // 159: project the sun for THIS camera (split-screen halves differ).
      applySunEffects(
        slot.skyPosterize,
        camera,
        lightUniforms.uSunDirWorld.value,
        rect.h > 0 ? rect.w / rect.h : 1,
        this._sunColorSrgb,
        this._fxGlow,
        this._fxConfig,
      );
      slot.composer.render();
    }
    this.snapshotFrameStats();
  }

  /**
   * Frame-accumulated renderer.info for the last completed frame: render
   * counters summed across every pass of every view, memory counters live.
   * Read-only snapshot; callers read it immediately (StatsHud from its own rAF).
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
   * Build the EffectComposer for one slot: RenderPass (LINEAR) ->
   * DepthCapturePass (shared layers-0+1 depth, needsSwap off) -> OutputPass
   * (ACES + sRGB) -> SkyPosterizePass (sky + grade + sun effects; reads the
   * shared depth) -> GroundMistPass (228 valley mist). Sized to the rect.
   */
  private buildSlot(w: number, h: number): ComposerSlot {
    // Camera is rebound every frame; a placeholder suffices for construction.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, cam);
    composer.addPass(renderPass);
    const depthCapture = new DepthCapturePass(this.scene, cam, w, h);
    composer.addPass(depthCapture);
    composer.addPass(new OutputPass());
    const skyPosterize = new SkyPosterizePass(depthCapture.depthTexture);
    composer.addPass(skyPosterize);
    const groundMist = new GroundMistPass(depthCapture.depthTexture);
    composer.addPass(groundMist);
    composer.setSize(w, h);
    return { composer, renderPass, depthCapture, skyPosterize, groundMist, w, h };
  }

  /**
   * Forward the shared {@link dayCycleState} into the scene's lights, Sky, fog,
   * and sky-posterize slots once per frame. Light tints + fog + sun direction
   * go through {@link applyDayCycleToTargets}; the rest is applied here.
   * Camera-independent, so called once at the top of renderViews.
   */
  private applyDayCycle(): void {
    const state = dayCycleState;
    applyDayCycleToTargets(state, this._dayCycleTargets);

    // Cap fog to the bounded world so distant terrain dissolves into haze at
    // its edge. No-op when the world is larger than the day-cycle fog far.
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      const clamped = scaleFogToWorld(fog.near, fog.far, this.worldHalfExtent);
      fog.near = clamped.near;
      fog.far = clamped.far;
    }

    // Cast shadows fade with elevation (0 below 3 deg, 1 above 18 deg). Drive
    // uShadowFade; keep the shadow map across the whole band, drop castShadow
    // only at fade 0 (deep night) so the cel shader recompiles shadowless.
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

    // Fan zenith/horizon + post grade (064) per slot. Slots build lazily so the
    // first frame's new slots use ctor defaults. 159: resolve the shared
    // sun-effect day-phase weight (0 at night) + sRGB sun tint once per frame;
    // applySunEffects fans them per view. 228: same shape for ground-mist inputs.
    this._fxGlow = glowIntensity(state.sunElevationDeg, state.sunIntensity, state.nightFactor);
    this._sunColorSrgb.copy(state.sunColor).convertLinearToSRGB();

    // 228: ground-mist per-frame inputs (camera-independent; fanned per slot).
    const mistTime = performance.now() * 0.001;
    const mistFactor = mistTimeFactor(state.sunElevationDeg, state.nightFactor);
    this._mistFogSrgb.copy(state.fogColor).convertLinearToSRGB();
    const mistStrength = this.groundMistStrength * (this._fxConfig.enables.groundMist ? 1 : 0);

    const postGrade = computePostGrade(state.cycleT, this.postGradeStrength);
    for (const slot of this.slots) {
      slot.skyPosterize.skyZenith.copy(this._skyScratchZenith);
      slot.skyPosterize.skyHorizon.copy(this._skyScratchHorizon);
      applyPostGradeToPass(slot.skyPosterize, postGrade);
      slot.groundMist.setMist(
        mistTime,
        mistStrength,
        this._mistFogSrgb,
        mistFactor,
        wetnessUniform.uWetness.value,
      );
    }
  }

  /**
   * Per-frame distance-based LOD pass for every kart. For each child tagged
   * userData.role === "kart" it resolves the LOD level from the NEAREST camera
   * distance + prev level (hysteresis) and applies it. Runs before the per-view
   * loop so every view sees the same LOD state. Skips the per-kart child
   * traverse when the level matches the cached prev (userData.lod).
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
   * state. Both {@link applyKartLod} + {@link applyTerrainLod} read it read-only.
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
   * Render counters carry the per-frame sum across every pass of every view;
   * memory counters are live.
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
   * Frame-accumulated renderer.info written by {@link snapshotFrameStats} and
   * exposed via {@link getFrameStats}. Reused across frames (no per-frame alloc).
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
   * Live Three objects {@link applyDayCycleToTargets} mutates each frame. Built
   * once in the ctor; zenith/horizon refs are scratch the per-slot fan-out reads
   * (slots are built lazily, so they cannot be bound here).
   */
  private readonly _dayCycleTargets: DayCycleLightTargets;
  private readonly _skyScratchZenith = new THREE.Color();
  private readonly _skyScratchHorizon = new THREE.Color();

  dispose(): void {
    for (const slot of this.slots) {
      slot.skyPosterize.dispose();
      slot.groundMist.dispose();
      slot.depthCapture.dispose();
      slot.composer.dispose();
    }
    this.slots = [];
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
