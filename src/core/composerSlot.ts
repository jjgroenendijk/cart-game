import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { DepthCapturePass } from "../materials/depthCapture";
import { NormalCapturePass } from "../materials/normalCapture";
import { AmbientOcclusionPass } from "../materials/ambientOcclusion";
import { GroundMistPass } from "../materials/groundMist";

/** 231: conceptual composer pass order. `bloom` false omits the Bloom pass
 *  (low tier / strength 0 -> byte-identical to pre-231). Pure for jsdom tests. */
export const COMPOSER_PASSES_WITH_BLOOM = [
  "Render",
  "Depth",
  "Normal",
  "AO",
  "SMAA",
  "Bloom",
  "Output",
  "SkyPosterize",
  "GroundMist",
] as const;
export const COMPOSER_PASSES_NO_BLOOM = [
  "Render",
  "Depth",
  "Normal",
  "AO",
  "SMAA",
  "Output",
  "SkyPosterize",
  "GroundMist",
] as const;
export function passOrder(bloom: boolean): readonly string[] {
  return bloom ? COMPOSER_PASSES_WITH_BLOOM : COMPOSER_PASSES_NO_BLOOM;
}

/**
 * The single EffectComposer slot, built lazily by {@link buildComposerSlot}
 * + resized to its rect by Renderer.ensureSlot. Extracted from Renderer to
 * keep that file under the 600-line cap (no behavior change). Renderer owns
 * the slot + the per-frame camera/uniform rebind; this module only owns
 * construction.
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
  /** 231 HDR bloom pass (LINEAR, pre-tonemap); null when the tier has no bloom (strength 0). */
  bloom: UnrealBloomPass | null;
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
 * UnrealBloomPass (231 HDR bloom; LINEAR pre-tonemap; threshold 1.0 so only
 * pixels >1 bloom; radius ~0.6; absent when bloomStrength <= 0) ->
 * OutputPass (ACES + sRGB) -> SkyPosterizePass (sky + grade + sun effects;
 * reads the shared depth) -> GroundMistPass (228 valley mist). Sized to rect.
 *
 * `smaaEnabled` is the tier-resolved SMAA gate (Renderer.smaaEnabled); it sets
 * the pass's `.enabled` so the EffectComposer skips it as a byte-identical
 * no-op when off. `bloomStrength` is the tier-resolved HDR bloom master gain
 * (0 = pass absent, byte-identical to pre-231; med 0.35, high 0.5).
 * `bloomHalfRes` renders the bloom pass at half composer resolution (med
 * tier cost gate); high runs full. Camera is a placeholder here — Renderer rebinds the active
 * camera on every pass each frame.
 */
export function buildComposerSlot(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  smaaEnabled: boolean,
  bloomStrength: number,
  bloomHalfRes: boolean,
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
  // 231: HDR bloom on LINEAR pre-tonemap color. Only inserted when the tier's
  // bloomStrength > 0 (low tier -> pass absent, byte-identical to pre-231).
  // threshold 1.0 keeps LDR surfaces (albedo*light <= 1) from ever blooming.
  const bloomStrengthVal = Math.max(0, bloomStrength);
  let bloom: UnrealBloomPass | null = null;
  if (bloomStrengthVal > 0) {
    const resDiv = bloomHalfRes ? 0.5 : 1;
    bloom = new UnrealBloomPass(
      new THREE.Vector2(w * resDiv, h * resDiv),
      bloomStrengthVal,
      0.6,
      1.0,
    );
    composer.addPass(bloom);
  }
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
    bloom,
    skyPosterize,
    groundMist,
    w,
    h,
  };
}
