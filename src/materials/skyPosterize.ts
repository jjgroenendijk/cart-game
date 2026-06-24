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
  uniform float uBandSharpness;
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
      // Smooth painted gradient zenith->horizon over the visible sky. The
      // natural Preetham gradient in the chase-cam view is too narrow
      // (camera looks down at the kart -> visible sky is a thin slice near
      // the horizon -> ACES tonemap compresses it to ~1 color step), so a
      // synthetic gradient replaces most of it. uSkyBands > 0 opts into
      // soft banding: the gradient is quantized into uSkyBands steps with
      // smoothstep transitions whose hardness is controlled by
      // uBandSharpness (0 = invisible bands / pure smooth gradient,
      // 1 = hard floor bands). uBandMix controls how much of the natural
      // Preetham variation (sun-direction tint) survives the replacement.
      float t = clamp((vUv.y - uSkyStart) / (1.0 - uSkyStart), 0.0, 1.0);
      float gradient = t;
      if (uSkyBands > 0.0) {
        float scaled = t * uSkyBands;
        float bandFloor = floor(scaled);
        float bandFrac = fract(scaled);
        // smoothstep(0,1) = soft S-curve. Mix toward step(0.5) for harder
        // edges. Result: continuous within a band, transitions softly to
        // the next level near the boundary.
        float soft = smoothstep(0.0, 1.0, bandFrac);
        float hard = step(0.5, bandFrac);
        float blended = mix(soft, hard, uBandSharpness);
        gradient = (bandFloor + blended) / max(uSkyBands - 1.0, 1.0);
      }
      vec3 synthetic = mix(uSkyHorizon, uSkyZenith, gradient);
      color = mix(color, synthetic, uBandMix);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface SkyPosterizeOpts {
  /**
   * Soft band count across the visible-sky elevation range. 0 (default) =
   * pure smooth gradient, no bands. >0 = quantize into N steps with
   * smoothstep transitions (hardness controlled by uBandSharpness).
   */
  skyBands?: number;
  /**
   * Band edge hardness when skyBands > 0 (default 0). 0 = soft smoothstep
   * transitions (bands barely visible), 1 = hard floor bands. Ignored when
   * skyBands = 0.
   */
  bandSharpness?: number;
  /** depth == 1.0 tolerance for the sky mask (default 1e-4). */
  depthEps?: number;
  /**
   * Lower bound of the visible-sky vUv.y range (default 0.55). Pixels with
   * vUv.y < uSkyStart are clamped to horizon tint; vUv.y = 1 is zenith.
   * Adjust per camera angle so the full zenith->horizon gradient is visible
   * without a flat clamped band at the horizon.
   */
  skyStart?: number;
  /** sRGB zenith tint (top of screen). Default deep sky blue. */
  skyZenith?: number;
  /** sRGB horizon tint (bottom of sky region). Default pale cream. */
  skyHorizon?: number;
  /**
   * 0 = keep natural Preetham sky untouched, 1 = fully replace with
   * synthetic gradient (default 0.7). Mix < 1 preserves some natural
   * hue/sun-disc variation.
   */
  bandMix?: number;
}

/**
 * Post-process painted sky gradient over the stock Preetham `Sky`. For each
 * sky pixel (those with no non-sky geometry in the depth pre-pass), blend a
 * synthetic zenith->horizon gradient (deep blue -> pale cream) over the
 * natural color so the visible sky has a clear value progression instead of
 * the ACES-compressed near-flat default. Non-sky pixels (kart, terrain,
 * props) pass through untouched.
 *
 * Default is a pure smooth gradient (uSkyBands = 0). Opt into soft banding
 * via uSkyBands > 0 + uBandSharpness. Pure color posterize on the stock
 * Preetham gradient does NOT produce visible bands in the chase-cam view
 * (the visible sky is a thin slice near the horizon -> ACES tonemap
 * compresses it to one color step); see
 * docs/troubleshooting/2026-06-21_002-procedural-sky.md.
 *
 * Runs AFTER OutputPass in the composer chain (post-tonemap sRGB). Owns its
 * own depth RT rendering non-sky layers (default 0+1); sky on layer 2 is
 * excluded from the depth pre-pass so it shows up as depth==1.0 -> masked
 * in for the gradient pass.
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
  /**
   * Camera the non-sky depth pre-pass renders with. Public + mutable so
   * Renderer can rebind the active camera each frame (menu cam vs chase cam);
   * render() saves/restores this camera's layer mask around the pre-pass.
   */
  camera: THREE.Camera;
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
          uSkyBands: { value: opts.skyBands ?? 0 },
          uBandSharpness: { value: opts.bandSharpness ?? 0 },
          uDepthEps: { value: opts.depthEps ?? 1e-4 },
          uSkyStart: { value: opts.skyStart ?? 0.55 },
          uSkyZenith: { value: new THREE.Color(opts.skyZenith ?? 0x4a8fcf) },
          uSkyHorizon: { value: new THREE.Color(opts.skyHorizon ?? 0xfde8c0) },
          uBandMix: { value: opts.bandMix ?? 0.7 },
        },
        vertexShader: POSTERIZE_VERT,
        fragmentShader: POSTERIZE_FRAG,
      }),
    );
  }

  /** Soft band count (default 0 = smooth gradient). Tunable at runtime. */
  get skyBands(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyBands.value as number;
  }

  set skyBands(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyBands.value = v;
  }

  /** Band edge hardness 0..1 when skyBands > 0 (default 0 = soft). */
  get bandSharpness(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandSharpness.value as number;
  }

  set bandSharpness(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandSharpness.value = v;
  }

  /** Synthetic->natural blend (0..1). Default 0.7. */
  get bandMix(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandMix.value as number;
  }

  set bandMix(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uBandMix.value = v;
  }

  /**
   * Live sRGB zenith tint uniform (top of screen). Returns the mutable
   * uniform Color so the Renderer can {@link THREE.Color.copy} the day-cycle
   * value into it each frame without reaching into the fsQuad material.
   */
  get skyZenith(): THREE.Color {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyZenith.value as THREE.Color;
  }

  /**
   * Live sRGB horizon tint uniform (bottom of the sky region). See
   * {@link skyZenith}; returned ref is mutated in place to update.
   */
  get skyHorizon(): THREE.Color {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uSkyHorizon.value as THREE.Color;
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
