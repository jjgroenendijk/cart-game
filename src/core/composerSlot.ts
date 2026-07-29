import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { DepthCapturePass } from "../materials/depthCapture";
import { NormalCapturePass } from "../materials/normalCapture";
import { AmbientOcclusionPass } from "../materials/ambientOcclusion";
import { GroundMistPass } from "../materials/groundMist";

/**
 * One per-view EffectComposer slot, built lazily by {@link buildComposerSlot}
 * + resized to its rect by Renderer.ensureSlot. Extracted from Renderer to
 * keep that file under the 600-line cap (no behavior change). Renderer owns
 * the slots array + the per-frame camera/uniform rebind; this module only
 * owns construction.
 */
export interface ComposerSlot {
  composer: EffectComposer;
  renderPass: RenderPass;
  /** Shared layers-0+1 packed RGBA8 depth capture; feeds depth consumers. */
  depthCapture: DepthCapturePass;
  /** 235 shared view-space normal capture; its texture feeds the AO pass. */
  normalCapture: NormalCapturePass;
  /** 235 GTAO ambient occlusion pass (composites LINEAR before OutputPass). */
  ao: AmbientOcclusionPass;
  /** 232 SMAA edge anti-aliasing (LINEAR sRGB, pre-tonemap). */
  smaa: SMAAPass;
  skyPosterize: SkyPosterizePass;
  /** 228 valley ground-mist pass; camera rebound per view. */
  groundMist: GroundMistPass;
  /** Current RT size (CSS px); ensureSlot resizes when this changes. */
  w: number;
  h: number;
}

/**
 * Build the EffectComposer for one slot: RenderPass (LINEAR) ->
 * DepthCapturePass (shared layers-0+1 depth, needsSwap off) ->
 * NormalCapturePass (235 shared view-space normals, needsSwap off) ->
 * AmbientOcclusionPass (235 GTAO; composites LINEAR pre-tonemap) ->
 * SMAAPass (232 edge AA; LINEAR pre-tonemap) ->
 * OutputPass (ACES + sRGB) -> SkyPosterizePass (sky + grade + sun effects;
 * reads the shared depth) -> GroundMistPass (228 valley mist). Sized to rect.
 *
 * `smaaEnabled` is the tier-resolved SMAA gate (Renderer.smaaEnabled); it sets
 * the pass's `.enabled` so the EffectComposer skips it as a byte-identical
 * no-op when off. Camera is a placeholder here — Renderer rebinds the active
 * camera on every pass each frame.
 */
export function buildComposerSlot(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  smaaEnabled: boolean,
  w: number,
  h: number,
): ComposerSlot {
  // Camera is rebound every frame; a placeholder suffices for construction.
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, cam);
  composer.addPass(renderPass);
  const depthCapture = new DepthCapturePass(scene, cam, w, h);
  composer.addPass(depthCapture);
  // 235: shared view-space normals for the AO pass.
  const normalCapture = new NormalCapturePass(scene, cam, w, h);
  composer.addPass(normalCapture);
  // 235: GTAO composites in LINEAR before OutputPass so the multiply is
  // pre-tonemap (physically motivated falloff, halo-free).
  const ao = new AmbientOcclusionPass(depthCapture.depthTexture, normalCapture.normalTexture);
  composer.addPass(ao);
  // 232: SMAA runs in LINEAR sRGB before OutputPass (three.js SMAAPass
  // requirement), as the last linear op after GTAO so edges are smoothed on
  // the final pre-tonemap image. Enabled by the `smaa` quality knob.
  const smaa = new SMAAPass();
  smaa.enabled = smaaEnabled;
  composer.addPass(smaa);
  composer.addPass(new OutputPass());
  const skyPosterize = new SkyPosterizePass(depthCapture.depthTexture);
  composer.addPass(skyPosterize);
  const groundMist = new GroundMistPass(depthCapture.depthTexture);
  composer.addPass(groundMist);
  composer.setSize(w, h);
  return {
    composer,
    renderPass,
    depthCapture,
    normalCapture,
    ao,
    smaa,
    skyPosterize,
    groundMist,
    w,
    h,
  };
}
