import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "../materials/lightUniforms";
import { applyPostGradeToPass, computePostGrade } from "../materials/postGrade";
import { DEFAULT_AO_PARAMS } from "../materials/ambientOcclusion";
import { mistTimeFactor } from "../materials/groundMistMath";
import { wetnessUniform } from "../materials/cel";
import { applyDayCycleToTargets, dayCycleState } from "../environment/dayCycle";
import type { DayCycleLightTargets } from "../environment/dayCycle";
import { SkyCapture, cubeMipCount } from "../environment/SkyCapture";
import { DEFAULT_QUALITY, qualityKnobs } from "./quality";
import type { QualityKnobs, QualityTier } from "./quality";
import type { EffectSettings } from "./settings";
import { FrameStatsSampler, type FrameStats } from "./frameStats";
import { SunFxState } from "./sunFxState";
import { buildComposerSlot, type ComposerSlot } from "./composerSlot";
import {
  applyKartLodGroup,
  kartLod,
  nearestCameraDistance,
  type KartLodLevel,
  type Pt,
} from "../kart/kartLod";
import type { Terrain } from "../terrain/Terrain";

export type { FrameStats } from "./frameStats";

/**
 * Axis-aligned rectangle in the drawing buffer, in CSS pixels, using the
 * WebGL bottom-left origin (y=0 at the bottom). renderView maps one
 * ViewDescriptor to a rect (full screen).
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

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  /**
   * 144 far shadow cascade light. Shadow-only: castShadow produces the far depth
   * map (the cel shader samples it as directionalShadowMap[1]); intensity 0 +
   * black color mean it contributes no lighting (CelMaterial ignores three's
   * per-light color). castShadow is gated by tier (farCascade) AND day-cycle fade.
   */
  readonly sunFar: THREE.DirectionalLight;
  /** 144: far cascade enabled on the active tier (med/high); off on low. */
  private farCascade = false;
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
  /** The single composer slot, built lazily + resized to its rect. */
  private slot: ComposerSlot | null = null;
  /** Current quality tier; null until the first setQuality() applies one. */
  private quality: QualityTier | null = null;
  /**
   * Master post-grade + vignette strength scalar from the active tier's knobs
   * (1 = full look, 0 = pre-064 identity). Near-free ALU, full on every tier.
   */
  private postGradeStrength = 1;
  // 228: tier-resolved ground-mist master gain (0 = identity/off).
  private groundMistStrength = 1;
  // 235: tier-resolved GTAO master gain (0 = identity/off) + slice count.
  private aoStrength = 1;
  private aoSlices = 6;
  // 235: user enable from Settings (default ON) + per-frame slice-rotation idx.
  private _aoEnabled = true;
  private _aoFrame = 0;
  // 232: tier-resolved SMAA enable (fanned to each slot's SMAAPass.enabled).
  private smaaEnabled = true;
  // 231: tier-resolved HDR bloom strength (0 = pass absent on low) + half-res cost gate.
  private bloomStrength = 0;
  private bloomHalfRes = false;
  // 283: runtime sky env capture (null on low tier / pre-init) + its cube size.
  private skyCapture: SkyCapture | null = null;
  private skyEnvSize = 0;
  // 231: user bloom enable from Settings (default ON); flips the pass's .enabled.
  private _bloomEnabled = true;
  // 159 sun-effect per-frame state + 228 ground-mist enable gate (the mist
  // pass itself stays here; SunFxState only owns enable + the sun gains).
  private readonly _sunFx = new SunFxState();
  // 228: scratch sRGB fog tint reused across frames (no per-frame alloc).
  private readonly _mistFogSrgb = new THREE.Color();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    // pixelRatio + shadow extents are applied by setQuality(DEFAULT_QUALITY)
    // below, after the sun + shadow camera exist.
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    // Sum render counters across every render() this frame; renderView resets at
    // frame start.
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

    // Sun direction source of truth lives in lightUniforms (world space).
    const sunDirWorld = lightUniforms.uSunDirWorld.value;

    // Procedural Preetham sky dome on layer 2 (sky-posterize masks layers 0+1).
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.layers.set(2);
    // Dome never moves; sun motion is a uniform -> freeze once.
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
    // Tier-independent shadow bits; mapSize/far/extents owned by setQuality.
    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.radius = 3.0;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 144 far cascade: shadow-only 2nd light; castShadow + extents owned by
    // setQuality. Larger bias/radius suit the wide far box.
    this.sunFar = new THREE.DirectionalLight(0x000000, 0);
    this.sunFar.castShadow = true;
    this.sunFar.shadow.camera.near = 1;
    this.sunFar.shadow.bias = -0.0004;
    this.sunFar.shadow.normalBias = 0.8;
    this.sunFar.shadow.radius = 4.0;
    this.scene.add(this.sunFar);
    this.scene.add(this.sunFar.target);

    this.setQuality(DEFAULT_QUALITY);
    this.setShadowTarget(0, 0);

    // Bind the pure day-cycle helper to the live Three objects it mutates.
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
    // 144 far cascade: farShadowMapSize 0 (low) disables it (single-cascade
    // path, byte-identical to pre-144); med/high enable the 2nd light.
    this.farCascade = k.farShadowMapSize > 0;
    this.sunFar.castShadow = this.farCascade;
    this.sunFar.shadow.mapSize.set(k.farShadowMapSize, k.farShadowMapSize);
    this.sunFar.shadow.camera.far = k.farShadowCameraFar;
    const fh = k.farShadowHalfExtent;
    this.sunFar.shadow.camera.left = -fh;
    this.sunFar.shadow.camera.right = fh;
    this.sunFar.shadow.camera.top = fh;
    this.sunFar.shadow.camera.bottom = -fh;
    this.sunFar.shadow.camera.updateProjectionMatrix();
    if (this.sunFar.shadow.map) {
      this.sunFar.shadow.map.dispose();
      this.sunFar.shadow.map = null;
    }
    this.sunFar.shadow.needsUpdate = true;
    // 144 cascade selection uniforms (shared by-ref; cel shader reads them).
    lightUniforms.uCascadeSplit.value.set(k.cascadeSplit, k.cascadeBlendWidth);
    this.postGradeStrength = k.postGradeStrength;
    this._sunFx.setStrengths(k.sunHaloStrength, k.godRayStrength, k.lensFlareStrength);
    this.groundMistStrength = k.groundMistStrength;
    this.aoStrength = k.aoStrength;
    this.aoSlices = k.aoSlices;
    this.smaaEnabled = k.smaa;
    this.bloomStrength = k.bloomStrength;
    this.bloomHalfRes = k.bloomHalfRes;
    // 283/243: 0<->nonzero size is an RT-swap; publish cube ref + strength + mipCount here.
    if (this.skyEnvSize !== k.skyEnvSize) {
      this.skyCapture?.dispose();
      this.skyCapture =
        k.skyEnvSize > 0 ? new SkyCapture(this.renderer, this.scene, k.skyEnvSize) : null;
      this.skyEnvSize = k.skyEnvSize;
      lightUniforms.uSkyEnv.value = this.skyCapture?.texture ?? null;
    }
    lightUniforms.uSkyEnvStrength.value = k.skyEnvSize > 0 ? 0.5 : 0;
    lightUniforms.uSkyEnvMipCount.value = k.skyEnvSize > 0 ? cubeMipCount(k.skyEnvSize) : 0;
    // Fan DPR + enable to the built slot (composer captures DPR at build, so a
    // runtime tier change resizes here). 231: a bloom presence flip rebuilds the
    // chain; med<->high just updates the existing pass strength.
    if (this.slot) {
      if ((this.slot.bloom != null) !== k.bloomStrength > 0) {
        this.disposeSlot();
      } else {
        this.slot.composer.setPixelRatio(k.pixelRatio);
        if (this.slot.bloom) this.slot.bloom.strength = k.bloomStrength;
        this.slot.smaa.enabled = k.smaa;
      }
    }
    this.quality = tier;
  }

  /**
   * 159: set the per-effect enables (from Settings). Copied so later settings
   * mutations do not leak in. Gains reach the pass on the next frame; when all
   * are off (or the sun is down) the pass stays a byte-identical no-op.
   */
  setEffects(effects: EffectSettings): void {
    this._sunFx.setEnables(effects.sunHalo, effects.godRays, effects.lensFlare, effects.groundMist);
    this._aoEnabled = effects.ambientOcclusion;
    this._bloomEnabled = effects.bloom;
    if (this.slot?.bloom) this.slot.bloom.enabled = effects.bloom;
  }

  setShadowTarget(x: number, z: number): void {
    // Place the light along the shared sun direction so shadows stay aligned
    // with the visible sun as the target follows the kart.
    const d = 160;
    const sunDirWorld = lightUniforms.uSunDirWorld.value;
    sunWorldPosition(sunDirWorld, this.sun.position, d);
    this.sun.position.x += x;
    this.sun.position.z += z;
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
    // 144 far cascade follows the same focus (wider ortho box, same sun axis).
    sunWorldPosition(sunDirWorld, this.sunFar.position, d);
    this.sunFar.position.x += x;
    this.sunFar.position.z += z;
    this.sunFar.target.position.set(x, 0, z);
    this.sunFar.target.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    // The single composer resizes lazily inside renderView (size = the view rect).
  }

  /** Single-view shorthand: one full-screen view. */
  render(camera: THREE.Camera): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderView({
      camera,
      rect: { x: 0, y: 0, w: size.width, h: size.height },
    });
  }

  /**
   * Render the single view into its own viewport via scissor + viewport. The
   * slot owns an EffectComposer sized to its rect. Rebind the active camera on
   * every pass (006 menu/chase swap), enable layers 1+2, refresh light +
   * sun-effect uniforms, then composer.render(). SkyPosterize runs in every
   * state so menu/countdown/paused share the gameplay backdrop instead of a
   * white sky.
   */
  renderView(view: ViewDescriptor): void {
    this.renderer.info.reset();
    this.applyDayCycle();
    // Build the camera-position list ONCE; both LOD passes read it read-only.
    const cams = this.cameraPositions(view);
    this.applyKartLod(cams);
    this.applyTerrainLod(cams);
    const { camera, rect } = view;
    const slot = this.ensureSlot(rect.w, rect.h);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
    this.renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
    slot.renderPass.camera = camera;
    slot.depthCapture.camera = camera;
    slot.groundMist.camera = camera;
    slot.normalCapture.camera = camera;
    slot.ao.camera = camera;
    slot.skyPosterize.enabled = true;
    camera.layers.enable(1);
    camera.layers.enable(2);
    camera.updateMatrixWorld();
    this.updateLightUniformsFor(camera);
    // 280: inverse view-proj so the sky elevation ramp follows the world.
    slot.skyPosterize.setView(camera);
    this._sunFx.apply(
      slot.skyPosterize,
      camera,
      lightUniforms.uSunDirWorld.value,
      rect.h > 0 ? rect.w / rect.h : 1,
    );
    slot.composer.render();
    this._frameStats.snapshot(this.renderer.info);
  }

  /**
   * Frame-accumulated renderer.info for the last completed frame: render
   * counters summed across every pass of every view, memory counters live.
   * Read-only snapshot; callers read it immediately (StatsHud from its own rAF).
   */
  getFrameStats(): FrameStats {
    return this._frameStats.get();
  }

  /** Build (if missing) or resize (if rect changed) the single composer slot. */
  private ensureSlot(w: number, h: number): ComposerSlot {
    const existing = this.slot;
    if (existing && existing.w === w && existing.h === h) return existing;
    if (existing) {
      existing.composer.setSize(w, h);
      existing.w = w;
      existing.h = h;
      return existing;
    }
    const slot = buildComposerSlot(
      this.renderer,
      this.scene,
      this.smaaEnabled,
      this.bloomStrength,
      this.bloomHalfRes,
      w,
      h,
    );
    if (slot.bloom) slot.bloom.enabled = this._bloomEnabled;
    this.slot = slot;
    return slot;
  }

  /**
   * Forward {@link dayCycleState} into the scene's lights, Sky, fog, and
   * sky-posterize slot once per frame. Camera-independent -> called once at the
   * top of renderView.
   */
  private applyDayCycle(): void {
    const state = dayCycleState;
    applyDayCycleToTargets(state, this._dayCycleTargets);

    // Cap fog to the bounded world (no-op when world > day-cycle fog far).
    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      const clamped = scaleFogToWorld(fog.near, fog.far, this.worldHalfExtent);
      fog.near = clamped.near;
      fog.far = clamped.far;
    }

    // Cast shadows fade with elevation; drop castShadow only at fade 0 (deep
    // night) so the cel shader recompiles shadowless.
    lightUniforms.uShadowFade.value = state.shadowFade;
    lightUniforms.uShadeTint.value.copy(state.shadeTint);
    lightUniforms.uTempContrast.value = state.tempContrast;
    this.sun.castShadow = shadowCastsFromFade(state.shadowFade);
    // 144 far cascade: toggle with the same fade as near, but only on tiers
    // where it exists (farCascade). Both lights off at fade 0 -> the cel shader
    // recompiles shadowless (NUM_DIR_LIGHT_SHADOWS 0), same as pre-144 night.
    this.sunFar.castShadow = this.farCascade && shadowCastsFromFade(state.shadowFade);

    // Intensity scalars + a darker ground shade of the ambient sky tint.
    this.sun.intensity = state.sunIntensity;
    this.ambient.intensity = state.ambientIntensity;
    this.ambient.groundColor.copy(state.ambientColor).multiplyScalar(0.5);
    // 282: per-phase tone-mapping exposure from the day-cycle keyframes.
    this.renderer.toneMappingExposure = state.exposure;

    // Sky sun disc direction (separate from lightUniforms.uSunDirWorld; the
    // helper already updated the shared sun dir uniform above).
    (this.sky.material.uniforms["sunPosition"].value as THREE.Vector3).copy(state.sunDirWorld);

    // 283: amortized sky capture (one face/frame; no-op when size 0). Cube ref
    // is published in setQuality; runs after the sunPosition write above.
    this.skyCapture?.update(state.cycleT);

    // Fan zenith/horizon + post grade (064) to the slot (lazy; first frame uses
    // ctor defaults). 159: resolve the shared sun-effect day-phase weight
    // day-phase weight (0 at night) + sRGB sun tint once per frame. 228: same
    // shape for ground-mist inputs.
    this._sunFx.resolveFrame(state);

    // 228: ground-mist per-frame inputs (camera-independent; fanned to the slot).
    const mistTime = performance.now() * 0.001;
    const mistFactor = mistTimeFactor(state.sunElevationDeg, state.nightFactor);
    this._mistFogSrgb.copy(state.fogColor).convertLinearToSRGB();
    const mistStrength = this.groundMistStrength * (this._sunFx.groundMistEnabled() ? 1 : 0);

    // 235: GTAO per-frame inputs (camera-independent; fanned to the slot). tier
    // strength x user enable (0 = byte-identical identity); advance the slice-
    // rotation dither once per frame.
    const aoStrength = this.aoStrength * (this._aoEnabled ? 1 : 0);
    this._aoFrame = (this._aoFrame + 1) % 1024;

    const postGrade = computePostGrade(state.cycleT, this.postGradeStrength);
    const slot = this.slot;
    if (slot) {
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
      slot.ao.setAo(aoStrength, this.aoSlices, DEFAULT_AO_PARAMS.floor, this._aoFrame);
    }
  }

  /**
   * Per-frame distance-based LOD pass for every kart. For each child tagged
   * userData.role === "kart" it resolves the LOD level from the NEAREST camera
   * distance + prev level (hysteresis) and applies it. Runs before the single
   * view renders. Skips the per-kart child traverse when the level matches the
   * cached prev (userData.lod).
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
   * Per-frame terrain LOD pass over the active camera, mirroring
   * {@link applyKartLod}. No-op until Game sets {@link terrain}.
   */
  private applyTerrainLod(cams: readonly Pt[]): void {
    if (!this.terrain) return;
    this.terrain.update(cams);
  }

  /**
   * Fill the pooled camera-position Pt[] from the single view's camera (always a
   * length-1 array: both LOD passes stay array-based for upstream parity).
   * Reused across frames so the LOD passes allocate zero objects at steady
   * state. Both {@link applyKartLod} + {@link applyTerrainLod} read it read-only.
   */
  private cameraPositions(view: ViewDescriptor): Pt[] {
    while (this._camPos.length < 1) this._camPos.push({ x: 0, y: 0, z: 0 });
    const c = view.camera.position;
    const p = this._camPos[0]!;
    p.x = c.x;
    p.y = c.y;
    p.z = c.z;
    this._camPos.length = 1;
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
      lightUniforms.uShadeTint.value,
      lightUniforms.uTempContrast.value,
      camera.matrixWorldInverse,
    );
  }

  private readonly _sunColorLinear = new THREE.Color();
  private readonly _ambientLinear = new THREE.Color();
  /** Pooled length-1 camera-position Pt[] reused by both LOD passes. */
  private readonly _camPos: Pt[] = [];
  /**
   * Frame-accumulated renderer.info sampled once per frame and exposed via
   * {@link getFrameStats}. Reused across frames (no per-frame alloc).
   */
  private readonly _frameStats = new FrameStatsSampler();
  /**
   * Live Three objects {@link applyDayCycleToTargets} mutates each frame. Built
   * once in the ctor; zenith/horizon refs are scratch the slot fan-out reads
   * (the slot is built lazily, so it cannot be bound here).
   */
  private readonly _dayCycleTargets: DayCycleLightTargets;
  private readonly _skyScratchZenith = new THREE.Color();
  private readonly _skyScratchHorizon = new THREE.Color();

  private disposeSlot(): void {
    const slot = this.slot;
    if (!slot) return;
    slot.skyPosterize.dispose();
    slot.groundMist.dispose();
    slot.depthCapture.dispose();
    slot.normalCapture.dispose();
    slot.ao.dispose();
    slot.smaa.dispose();
    if (slot.bloom) slot.bloom.dispose();
    slot.composer.dispose();
    this.slot = null;
  }

  dispose(): void {
    this.disposeSlot();
    this.skyCapture?.dispose();
    if (this.sunFar.shadow.map) this.sunFar.shadow.map.dispose();
    this.scene.remove(this.sunFar);
    this.scene.remove(this.sunFar.target);
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
