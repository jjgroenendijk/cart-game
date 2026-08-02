import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const BLOOM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Selective-bloom composite: add the blurred emissive buffer over the main
 * LINEAR color buffer. The blur comes from {@link unreal} (UnrealBloomPass) run
 * on the {@link EmissiveCapturePass} RT, so ONLY genuine emitters bleed light;
 * ordinary surfaces + the raw sky never enter the blur (the #310 washout fix).
 */
const BLOOM_COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor; // composer LINEAR pre-tonemap buffer (SMAA output)
  uniform sampler2D tBloom; // UnrealBloomPass composite output (pure bloom)
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    color += texture2D(tBloom, vUv).rgb;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Selective HDR bloom: blurs the {@link EmissiveCapturePass} emissive RT with an
 * UnrealBloomPass, then additively composites the PURE bloom (not the raw
 * emitters) over the main LINEAR pre-tonemap color buffer before OutputPass.
 *
 * The emitters themselves stay sharp in the main RenderPass (e.g. the sun disc);
 * only their bleed is added here, so nothing doubles. To get pure bloom, this
 * runs UnrealBloomPass on the emissive RT in place (its in-place additive step
 * pollutes the emissive RT, which is harmless — re-cleared next frame) and reads
 * the bloom from UnrealBloomPass's composite target `renderTargetsHorizontal[0]`
 * (the blurred-bright result before its own additive blend), which stays clean.
 *
 * `threshold` is ~0 because the emissive RT already contains ONLY emitters (no
 * sky / ordinary surfaces), so every non-black pixel should bloom. Tier-gated
 * via `.enabled` (off -> byte-identical: composer skips the pass, no capture).
 */
export class BloomPass extends Pass {
  /** The wrapped UnrealBloomPass; Renderer fans strength/radius into it. */
  readonly unreal: UnrealBloomPass;
  /**
   * Half-resolution flag: when true the blur runs at half the slot resolution
   * (med tier) for a cheaper mip chain; the composite upscales. High tier runs
   * full resolution.
   */
  halfRes: boolean;

  private readonly emissiveRT: THREE.WebGLRenderTarget;
  private readonly fsQuad: FullScreenQuad;

  constructor(
    emissiveRT: THREE.WebGLRenderTarget,
    width: number,
    height: number,
    strength: number,
    radius: number,
    halfRes: boolean,
  ) {
    super();
    this.emissiveRT = emissiveRT;
    this.halfRes = halfRes;
    // Writes the composited color into the writeBuffer -> the composer must swap.
    this.needsSwap = true;

    const ew = halfRes ? Math.max(1, Math.round(width / 2)) : width;
    const eh = halfRes ? Math.max(1, Math.round(height / 2)) : height;
    // threshold 0: the emissive RT is already emitter-only.
    this.unreal = new UnrealBloomPass(new THREE.Vector2(ew, eh), strength, radius, 0);
    this.fsQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null as THREE.Texture | null },
          tBloom: { value: null as THREE.Texture | null },
        },
        vertexShader: BLOOM_VERT,
        fragmentShader: BLOOM_COMPOSITE_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  /** Bloom strength (0 = identity output, but prefer pass.enabled = false). */
  setStrength(v: number): void {
    this.unreal.strength = v;
  }

  /** Bloom radius (UnrealBloomPass range [0,1]). */
  setRadius(v: number): void {
    this.unreal.radius = v;
  }

  setSize(width: number, height: number): void {
    const ew = this.halfRes ? Math.max(1, Math.round(width / 2)) : width;
    const eh = this.halfRes ? Math.max(1, Math.round(height / 2)) : height;
    this.unreal.setSize(ew, eh);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget | null,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // 1. Blur the emissive RT. Pass it as both buffers: UnrealBloomPass reads
    //    readBuffer.texture for the high pass and writes its additive blend back
    //    into readBuffer. That pollutes the emissive RT (emitters + bloom), which
    //    is fine — EmissiveCapturePass re-clears it next frame.
    this.unreal.render(renderer, this.emissiveRT, this.emissiveRT, 0, false);
    // 2. Composite the PURE bloom (UnrealBloomPass's composite target, written in
    //    its step 3 and left untouched by its step-4 additive) over the main
    //    LINEAR color buffer. renderTargetsHorizontal[0] is the stable composite
    //    output target the pass has used since its inception.
    const m = this.fsQuad.material as THREE.ShaderMaterial;
    m.uniforms.tColor.value = readBuffer.texture;
    m.uniforms.tBloom.value = this.unreal.renderTargetsHorizontal[0]!.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose(): void {
    this.unreal.dispose();
    (this.fsQuad.material as THREE.Material).dispose();
    this.fsQuad.dispose();
  }
}
