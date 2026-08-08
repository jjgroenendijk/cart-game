import * as THREE from "three";
import { Pass, MipmapBlurPass } from "postprocessing";

const BLOOM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Selective-bloom composite: add the blurred emissive buffer over the main
 * LINEAR color buffer. The blur comes from a {@link MipmapBlurPass} run on the
 * {@link EmissiveCapturePass} RT, so ONLY genuine emitters bleed light;
 * ordinary surfaces + the raw sky never enter the blur (the #310 washout fix).
 */
const BLOOM_COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    color += texture2D(tBloom, vUv).rgb * uStrength;
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Selective HDR bloom: blurs the {@link EmissiveCapturePass} emissive RT with a
 * pmndrs {@link MipmapBlurPass} (mipmap downsampling + upsampling), then
 * additively composites the blurred result over the main LINEAR pre-tonemap
 * color buffer before the tonemap pass.
 *
 * The emitters themselves stay sharp in the main RenderPass (e.g. the sun disc);
 * only their bleed is added here, so nothing doubles. `uStrength` scales the
 * additive bloom (0 = identity). Tier-gated via `.enabled` (off -> byte-identical:
 * composer skips the pass, no capture).
 */
export class BloomPass extends Pass {
  /** The wrapped MipmapBlurPass; Renderer fans radius into it. */
  readonly blurPass: MipmapBlurPass;
  /**
   * Half-resolution flag: when true the blur runs at half the slot resolution
   * (med tier) for a cheaper mip chain; the composite upscales. High tier runs
   * full resolution.
   */
  halfRes: boolean;

  private readonly emissiveRT: THREE.WebGLRenderTarget;

  constructor(
    emissiveRT: THREE.WebGLRenderTarget,
    width: number,
    height: number,
    strength: number,
    radius: number,
    halfRes: boolean,
  ) {
    super("BloomPass");
    this.emissiveRT = emissiveRT;
    this.halfRes = halfRes;
    this.needsSwap = true;

    this.blurPass = new MipmapBlurPass();
    this.blurPass.radius = radius;

    const ew = halfRes ? Math.max(1, Math.round(width / 2)) : width;
    const eh = halfRes ? Math.max(1, Math.round(height / 2)) : height;
    this.blurPass.setSize(ew, eh);

    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null as THREE.Texture | null },
        tBloom: { value: null as THREE.Texture | null },
        uStrength: { value: strength },
      },
      vertexShader: BLOOM_VERT,
      fragmentShader: BLOOM_COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Bloom strength (0 = identity output, but prefer pass.enabled = false). */
  setStrength(v: number): void {
    (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms.uStrength.value = v;
  }

  /** Bloom radius (MipmapBlurPass [0,1]). */
  setRadius(v: number): void {
    this.blurPass.radius = v;
  }

  setSize(width: number, height: number): void {
    const ew = this.halfRes ? Math.max(1, Math.round(width / 2)) : width;
    const eh = this.halfRes ? Math.max(1, Math.round(height / 2)) : height;
    this.blurPass.setSize(ew, eh);
  }

  override initialize(
    renderer: THREE.WebGLRenderer,
    alpha: boolean,
    frameBufferType: number,
  ): void {
    this.blurPass.initialize(renderer, alpha, frameBufferType);
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
    deltaTime?: number,
  ): void {
    this.blurPass.render(renderer, this.emissiveRT, this.emissiveRT, deltaTime, false);

    const m = this.fullscreenMaterial as THREE.ShaderMaterial;
    m.uniforms.tColor.value = inputBuffer!.texture;
    m.uniforms.tBloom.value = this.blurPass.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.blurPass.dispose();
    (this.fullscreenMaterial as THREE.Material).dispose();
  }
}
