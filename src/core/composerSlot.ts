import * as THREE from "three";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { SkyPosterizePass } from "../materials/skyPosterize";
import { DepthCapturePass } from "../materials/depthCapture";
import { NormalCapturePass } from "../materials/normalCapture";
import { AmbientOcclusionPass } from "../materials/ambientOcclusion";
import { GroundMistPass } from "../materials/groundMist";
import { EmissiveCapturePass } from "../materials/emissiveCapture";
import { BloomPass } from "../materials/bloom";

/** Conceptual composer pass order. Pure for jsdom tests. */
export const COMPOSER_PASSES = [
  "Render",
  "Depth",
  "Normal",
  "AO",
  "SMAA",
  "Emissive",
  "Bloom",
  "Output",
  "SkyPosterize",
  "GroundMist",
] as const;
export function passOrder(): readonly string[] {
  return COMPOSER_PASSES;
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
  /** 235 GTAO ambient occlusion pass (composites LINEAR before tonemap). */
  ao: AmbientOcclusionPass;
  /** 232 SMAA edge anti-aliasing (LINEAR sRGB, pre-tonemap). */
  smaa: EffectPass;
  /** Selective-bloom emitter capture (layer 3 -> HalfFloat emissive RT). */
  emissive: EmissiveCapturePass;
  /** Selective HDR bloom on the emissive RT, composited LINEAR pre-tonemap. */
  bloom: BloomPass;
  /** ACES Filmic tonemap (replaces three.js OutputPass). */
  tonemap: EffectPass;
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
 * SMAA EffectPass (232 edge AA; LINEAR pre-tonemap) ->
 * EmissiveCapturePass (emitter-only HalfFloat RT, needsSwap off) ->
 * BloomPass (selective HDR bloom on the emissive RT, composited LINEAR) ->
 * ToneMapping EffectPass (ACES Filmic) -> SkyPosterizePass (sky + grade; reads
 * shared depth) -> GroundMistPass (228 valley mist). Sized to rect.
 *
 * `smaaEnabled` is the tier-resolved SMAA gate (Renderer.smaaEnabled); it sets
 * the EffectPass's `.enabled` so the EffectComposer skips it as a byte-identical
 * no-op when off. `bloom` likewise: the tier-resolved bloom config sets
 * BloomPass `.enabled` (and EmissiveCapturePass is skipped via needsSwap-off +
 * the Renderer only flags it on when bloom is live). Camera is a placeholder
 * here — Renderer rebinds the active camera on every pass each frame.
 *
 * Scene-wide HDR bloom is intentionally absent: a luminance threshold cannot
 * distinguish the raw sky / ordinary sunlit surfaces from genuine emitters
 * (#310). Bloom is SELECTIVE — only the dedicated emissive layer feeds it.
 */
export interface BloomSlotConfig {
  strength: number;
  radius: number;
  halfRes: boolean;
}

export function buildComposerSlot(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  smaaEnabled: boolean,
  w: number,
  h: number,
  bloom: BloomSlotConfig,
): ComposerSlot {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  const renderPass = new RenderPass(scene, cam);
  composer.addPass(renderPass);
  const depthCapture = new DepthCapturePass(scene, cam, w, h);
  composer.addPass(depthCapture);
  const normalCapture = new NormalCapturePass(scene, cam, w, h);
  composer.addPass(normalCapture);
  const ao = new AmbientOcclusionPass(depthCapture.depthTexture, normalCapture.normalTexture);
  composer.addPass(ao);
  const smaaEffect = new SMAAEffect();
  const smaa = new EffectPass(cam, smaaEffect);
  smaa.enabled = smaaEnabled;
  composer.addPass(smaa);
  const emissive = new EmissiveCapturePass(scene, cam, w, h);
  composer.addPass(emissive);
  const bloomPass = new BloomPass(
    emissive.emissiveRT,
    w,
    h,
    bloom.strength,
    bloom.radius,
    bloom.halfRes,
  );
  bloomPass.enabled = bloom.strength > 0;
  composer.addPass(bloomPass);
  const tonemapEffect = new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  });
  const tonemap = new EffectPass(cam, tonemapEffect);
  composer.addPass(tonemap);
  const skyPosterize = new SkyPosterizePass(depthCapture.depthTexture);
  composer.addPass(skyPosterize);
  const groundMist = new GroundMistPass(depthCapture.depthTexture);
  composer.addPass(groundMist);
  composer.setSize(w, h, false);
  return {
    composer,
    renderPass,
    depthCapture,
    normalCapture,
    ao,
    smaa,
    emissive,
    bloom: bloomPass,
    tonemap,
    skyPosterize,
    groundMist,
    w,
    h,
  };
}
