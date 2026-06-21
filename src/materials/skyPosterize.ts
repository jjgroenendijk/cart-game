import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Pure TS mirror of the GLSL posterize math (floor(value * bands) / bands).
 * Exported so unit tests can assert the band steps the shader will produce
 * without spinning up WebGL. Matches CelMaterial's banding convention
 * (cel.ts: floor(NdL * uBands) / uBands).
 */
export function posterizeChannel(value: number, bands: number): number {
  return Math.floor(value * bands) / bands;
}

const DEPTH_VERT = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DEPTH_FRAG = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
`;

const POSTERIZE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POSTERIZE_FRAG = /* glsl */ `
  // sRGB post-tonemap color from the composer readBuffer (OutputPass output).
  uniform sampler2D tColor;
  // Non-sky depth pre-pass: layers 0+1 only. Cleared to 1.0 -> sky pixel.
  uniform sampler2D tDepth;
  uniform float uSkyBands;
  uniform float uDepthEps;
  uniform float uSkyStart;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform float uBandMix;

  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float depth = texture2D(tDepth, vUv).r;

    // Mask = exact far plane (cleared, no non-sky geometry drew here).
    // Exact match avoids false positives on distant background geometry.
    if (depth >= 1.0 - uDepthEps) {
      // Ghibli horizontal bands. The natural Preetham gradient in the
      // chase-cam view is too narrow (camera looks down at the kart ->
      // visible sky is a thin slice near the horizon -> ACES tonemap
      // compresses it to ~1 color band, so naive floor(color*bands)/bands
      // produces uniform gray). Quantize the visible-sky elevation range
      // [uSkyStart, 1] into uSkyBands discrete steps and blend a synthetic
      // zenith->horizon gradient so the full tint range is visible.
      // uBandMix = 1 fully replaces natural sky; < 1 keeps some Preetham
      // hue/sun variation.
      float t = clamp((vUv.y - uSkyStart) / (1.0 - uSkyStart), 0.0, 1.0);
      float band = floor(t * uSkyBands) / max(uSkyBands - 1.0, 1.0);
      vec3 synthetic = mix(uSkyHorizon, uSkyZenith, band);
      color = mix(color, synthetic, uBandMix);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface SkyPosterizeOpts {
  /**
   * Discrete band count across the visible-sky elevation range
   * [uSkyStart, 1] (default 4). Tune up for finer banding, down for
   * fewer/coarser bands.
   */
  skyBands?: number;
  /** depth == 1.0 tolerance for the sky mask (default 1e-4). */
  depthEps?: number;
  /**
   * Lower bound of the visible-sky vUv.y range (default 0.5). Pixels with
   * vUv.y < uSkyStart are treated as horizon (band 0); vUv.y = 1 is zenith.
   * Adjust per camera angle so the full zenith->horizon gradient is visible.
   */
  skyStart?: number;
  /** sRGB zenith tint (top of screen). Default deep sky blue. */
  skyZenith?: number;
  /** sRGB horizon tint (bottom of sky region). Default pale cream. */
  skyHorizon?: number;
  /**
   * 0 = keep natural Preetham sky untouched, 1 = fully replace with
   * synthetic banded gradient (default 0.85). Mix < 1 preserves some
   * natural hue/sun-disc variation.
   */
  bandMix?: number;
}

/**
 * Post-process Ghibli-style sky banding. For each sky pixel (those with no
 * non-sky geometry in the depth pre-pass), quantize screen elevation into
 * `uSkyBands` discrete bands and blend a synthetic zenith->horizon gradient
 * (deep blue -> pale cream) over the stock Preetham `Sky` color, producing
 * ~4 painted horizontal bands. Non-sky pixels (kart, terrain, props) pass
 * through untouched.
 *
 * Pure color posterize on the stock Preetham gradient does NOT produce
 * visible bands in the chase-cam view (the visible sky is a thin slice near
 * the horizon -> ACES tonemap compresses it to one color step). The
 * synthetic gradient mix is the documented deviation; see
 * docs/troubleshooting/2026-06-21_002-procedural-sky.md.
 *
 * Runs AFTER OutputPass in the composer chain (post-tonemap sRGB). Owns its
 * own depth RT rendering non-sky layers (default 0+1); sky on layer 2 is
 * excluded from the depth pre-pass so it shows up as depth==1.0 -> masked
 * in for posterize.
 */
export class SkyPosterizePass extends Pass {
  readonly depthRT: THREE.WebGLRenderTarget;
  readonly depthMaterial: THREE.ShaderMaterial;
  /**
   * Camera layer mask treated as non-sky (occludes the posterize mask).
   * Default 0b011 = layers 0 (solid) + 1 (terrain); sky on layer 2 stays
   * masked in.
   */
  nonSkyLayersMask = 0b011;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly fsQuad: FullScreenQuad;
  private savedLayersMask = 0;
  private readonly savedClearColor = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width = 1024,
    height = 1024,
    opts: SkyPosterizeOpts = {},
  ) {
    super();
    this.scene = scene;
    this.camera = camera;

    this.depthRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.depthRT.depthTexture = depthTexture;

    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
    });

    this.fsQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null as THREE.Texture | null },
          tDepth: { value: this.depthRT.depthTexture },
          uSkyBands: { value: opts.skyBands ?? 4 },
          uDepthEps: { value: opts.depthEps ?? 1e-4 },
          uSkyStart: { value: opts.skyStart ?? 0.5 },
          uSkyZenith: { value: new THREE.Color(opts.skyZenith ?? 0x4a8fcf) },
          uSkyHorizon: { value: new THREE.Color(opts.skyHorizon ?? 0xfde8c0) },
          uBandMix: { value: opts.bandMix ?? 0.85 },
        },
        vertexShader: POSTERIZE_VERT,
        fragmentShader: POSTERIZE_FRAG,
      }),
    );
  }

  /** Discrete sky band count (default 4). Tunable at runtime. */
  get skyBands(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyBands.value as number;
  }

  set skyBands(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyBands.value = v;
  }

  /** Synthetic->natural blend (0..1). Default 0.85. */
  get bandMix(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandMix.value as number;
  }

  set bandMix(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandMix.value = v;
  }

  setSize(width: number, height: number): void {
    this.depthRT.setSize(width, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget | null,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // 1) Capture non-sky depth (layers 0+1) so sky shows as cleared far plane.
    this.savedLayersMask = this.camera.layers.mask;
    this.camera.layers.mask = this.nonSkyLayersMask;
    const prevOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.depthMaterial;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.depthRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    this.scene.overrideMaterial = prevOverride;
    this.camera.layers.mask = this.savedLayersMask;

    // 2) Composite: posterize sky pixels, pass through everything else.
    const m = this.fsQuad.material as THREE.ShaderMaterial;
    m.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose(): void {
    this.depthRT.dispose();
    this.depthMaterial.dispose();
    (this.fsQuad.material as THREE.Material).dispose();
    this.fsQuad.dispose();
  }
}
