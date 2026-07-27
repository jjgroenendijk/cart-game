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

const POSTERIZE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const POSTERIZE_FRAG = /* glsl */ `
  // Fixed god-ray march length. Constant so the loop bound is compile-time.
  #define GODRAY_SAMPLES 32

  // sRGB post-tonemap color from the composer readBuffer (OutputPass output).
  uniform sampler2D tColor;
  // Combined layers-0+1 depth (props/karts/weather + terrain/walls/water),
  // provided externally by DepthCapturePass. Cleared to 1.0, so sky stays 1.0.
  uniform sampler2D tDepth;
  uniform float uSkyBands;
  uniform float uBandSharpness;
  uniform float uDepthEps;
  uniform float uSkyStart;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform float uBandMix;
  uniform float uVignetteStrength;
  uniform float uVignetteRadius;
  uniform float uGradeSat;
  uniform float uGradeWarm;
  uniform float uGradeLift;
  // 159 sun light effects. Neutral gains (uHalo/uGodray/uFlare = 0) -> the
  // whole block is a no-op, so the pre-159 frame reproduces exactly.
  uniform vec2 uSunUv;       // projected sun screen uv (per view)
  uniform float uSunFront;   // smooth [0,1] front weight; 0 behind the camera
  uniform vec3 uSunColor;    // sRGB sun tint
  uniform float uAspect;     // view width / height (round halo + ghosts)
  uniform float uHaloIntensity;
  uniform float uHaloRadius;
  uniform float uGodrayIntensity;
  uniform float uGodrayDensity;
  uniform float uGodrayDecay;
  uniform float uGodrayWeight;
  uniform float uFlareIntensity;
  uniform float uFlareOccRadius;  // 208 uv spread of the sun-occlusion cross kernel

  varying vec2 vUv;

  // Non-sky scene depth from the shared DepthCapturePass layers-0+1 buffer. The
  // buffer clears to 1.0, so a sky pixel (no non-sky geometry) stays exactly
  // 1.0 -> masked in for the gradient. Both the sky mask and the god-ray march
  // read this single combined depth.
  float sceneDepth(vec2 uv) {
    return texture2D(tDepth, uv).r;
  }

  // Soft procedural lens ghost: a disc of radius \`size\` at fraction \`f\` along
  // the sun->screen-center axis. Aspect-corrected so it stays round.
  float lensGhost(vec2 axis, float f, float size) {
    vec2 gp = uSunUv + axis * f;
    vec2 d = (vUv - gp) * vec2(uAspect, 1.0);
    return smoothstep(size, 0.0, length(d));
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float depth = sceneDepth(vUv);

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

    // 064: day-phase grade (uniform per pixel, post-posterize). Neutral
    // defaults (uGradeSat/Warm/Lift = 0) make this path a no-op so the
    // pre-064 frame reproduces exactly until the Renderer wires values.
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(gray), color, 1.0 + uGradeSat);
    color.r += uGradeWarm;
    color.b -= uGradeWarm;
    color += vec3(uGradeLift);

    // 159: sun light effects, additive over the graded color. All gated by
    // uSunFront (0 when the sun is behind the camera) and by per-effect gains
    // that a Settings toggle drives to 0. sky = 1 on masked-in sky pixels.
    float sky = step(1.0 - uDepthEps, depth);
    vec2 sunToPix = (vUv - uSunUv) * vec2(uAspect, 1.0);

    // Soft painted halo: a gaussian bloom of the sun disc, sky-masked so a
    // dune/ridge silhouette hard-cuts the glow (the "half-eaten sunset").
    float hr = length(sunToPix);
    float halo = exp(-hr * hr / max(uHaloRadius * uHaloRadius, 1e-4));
    color += uHaloIntensity * uSunFront * sky * halo * uSunColor;

    // God rays: screen-space radial march of the sky mask toward the sun. Each
    // step reads the combined sceneDepth (sky = light, geometry = shadow) with
    // distance decay, yielding crepuscular shafts cut by silhouettes. Added
    // over every pixel and scaled by uSunFront so the full-screen wash fades
    // out smoothly as the sun turns behind the camera (no on/off flash).
    // Guarded so the disabled path skips the loop entirely (free when off).
    if (uGodrayIntensity * uSunFront > 0.0) {
      vec2 gstep = (vUv - uSunUv) * (uGodrayDensity / float(GODRAY_SAMPLES));
      vec2 gpos = vUv;
      float illum = 0.0;
      float gdecay = 1.0;
      for (int i = 0; i < GODRAY_SAMPLES; i++) {
        gpos -= gstep;
        illum += step(1.0 - uDepthEps, sceneDepth(gpos)) * gdecay * uGodrayWeight;
        gdecay *= uGodrayDecay;
      }
      illum /= float(GODRAY_SAMPLES);
      color += uGodrayIntensity * illum * uSunFront * uSunColor;
    }

    // Lens flare: procedural ghosts + a thin anamorphic streak along the
    // sun->center axis. A camera artifact, default off. Depth-masked at the
    // projected sun point (208): a 5-tap cross averaging sky-coverage fades
    // the whole flare off as the sun dips behind a ridge, so ghosts no longer
    // draw over terrain when the source is occluded.
    if (uFlareIntensity * uSunFront > 0.0) {
      float cov = step(1.0 - uDepthEps, sceneDepth(uSunUv));
      cov += step(1.0 - uDepthEps, sceneDepth(uSunUv + vec2(uFlareOccRadius, 0.0)));
      cov += step(1.0 - uDepthEps, sceneDepth(uSunUv - vec2(uFlareOccRadius, 0.0)));
      cov += step(1.0 - uDepthEps, sceneDepth(uSunUv + vec2(0.0, uFlareOccRadius)));
      cov += step(1.0 - uDepthEps, sceneDepth(uSunUv - vec2(0.0, uFlareOccRadius)));
      float sunVis = cov / 5.0;
      vec2 axis = vec2(0.5) - uSunUv;
      vec3 flare = vec3(0.7, 0.55, 1.0) * lensGhost(axis, 0.32, 0.09);
      flare += vec3(1.0, 0.82, 0.5) * lensGhost(axis, 0.58, 0.06);
      flare += vec3(0.55, 1.0, 0.75) * lensGhost(axis, -0.26, 0.05);
      float streak = smoothstep(0.35, 0.0, abs(sunToPix.y)) * smoothstep(0.6, 0.0, abs(sunToPix.x));
      flare += vec3(1.0, 0.9, 0.7) * streak * 0.35;
      color += uFlareIntensity * flare * uSunFront * sunVis * uSunColor;
    }

    // 064: vignette corner darkening. d mirrors GLSL length(vUv - vec2(0.5));
    // 0.70710678 = sqrt(0.5) = distance center->corner. uVignetteStrength = 0
    // -> factor 1 -> identity.
    float vd = length(vUv - vec2(0.5));
    color *= 1.0 - uVignetteStrength * smoothstep(uVignetteRadius, 0.70710678, vd);

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
  /** 159 sun-halo gaussian falloff radius in uv (default 0.32). */
  haloRadius?: number;
  /** 159 god-ray march span toward the sun as a uv fraction (default 0.9). */
  godrayDensity?: number;
  /** 159 god-ray per-sample decay (default 0.96). */
  godrayDecay?: number;
  /** 159 god-ray per-sample weight (default 1.0). */
  godrayWeight?: number;
  /**
   * 208 uv spread of the lens-flare sun-occlusion cross kernel (default 0.01).
   * Larger = the flare starts fading sooner as the sun nears a ridge.
   */
  flareOccRadius?: number;
}

/**
 * Post-process painted sky gradient over the stock Preetham `Sky`. For each
 * sky pixel (those with no non-sky geometry in the depth pre-pass), blend a
 * synthetic zenith->horizon gradient (deep blue -> pale cream) over the
 * natural color so the visible sky has a clear value progression instead of
 * the ACES-compressed near-flat default. Non-sky pixels (kart, terrain,
 * props) pass through the sky-replacement untouched but still receive the
 * uniform day-phase grade + vignette (064).
 *
 * Default is a pure smooth gradient (uSkyBands = 0). Opt into soft banding
 * via uSkyBands > 0 + uBandSharpness. Pure color posterize on the stock
 * Preetham gradient does NOT produce visible bands in the chase-cam view
 * (the visible sky is a thin slice near the horizon -> ACES tonemap
 * compresses it to one color step); see
 * docs/troubleshooting/2026-06-21_002-procedural-sky.md.
 *
 * Runs AFTER OutputPass in the composer chain (post-tonemap sRGB). It no longer
 * captures depth itself: it reads a shared `tDepth` DepthTexture provided by
 * DepthCapturePass, which renders layers 0 AND 1 (props/karts/weather +
 * terrain/walls/water) into one combined depth buffer. Sky on layer 2 is
 * excluded, so it shows up as depth==1.0 -> masked in for the gradient pass.
 * Both the sky mask and the god-ray march read this single shared layers-0+1
 * depth via `sceneDepth`.
 */
export class SkyPosterizePass extends Pass {
  private readonly fsQuad: FullScreenQuad;

  constructor(depthTexture: THREE.DepthTexture, opts: SkyPosterizeOpts = {}) {
    super();

    this.fsQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null as THREE.Texture | null },
          tDepth: { value: depthTexture as THREE.Texture },
          uSkyBands: { value: opts.skyBands ?? 0 },
          uBandSharpness: { value: opts.bandSharpness ?? 0 },
          uDepthEps: { value: opts.depthEps ?? 1e-4 },
          uSkyStart: { value: opts.skyStart ?? 0.55 },
          uSkyZenith: { value: new THREE.Color(opts.skyZenith ?? 0x4a8fcf) },
          uSkyHorizon: { value: new THREE.Color(opts.skyHorizon ?? 0xfde8c0) },
          uBandMix: { value: opts.bandMix ?? 0.7 },
          // 064: post-grade uniforms, neutral-by-default (identity output).
          uVignetteStrength: { value: 0 },
          uVignetteRadius: { value: 0.35 },
          uGradeSat: { value: 0 },
          uGradeWarm: { value: 0 },
          uGradeLift: { value: 0 },
          // 159: sun-effect uniforms, neutral-by-default (all gains 0 = off).
          uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
          uSunFront: { value: 0 },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uAspect: { value: 1 },
          uHaloIntensity: { value: 0 },
          uHaloRadius: { value: opts.haloRadius ?? 0.32 },
          uGodrayIntensity: { value: 0 },
          uGodrayDensity: { value: opts.godrayDensity ?? 0.9 },
          uGodrayDecay: { value: opts.godrayDecay ?? 0.96 },
          uGodrayWeight: { value: opts.godrayWeight ?? 1.0 },
          uFlareIntensity: { value: 0 },
          uFlareOccRadius: { value: opts.flareOccRadius ?? 0.01 },
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

  /** Vignette corner darkening strength (0 = off/identity; default 0). */
  get vignetteStrength(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uVignetteStrength
      .value as number;
  }

  set vignetteStrength(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uVignetteStrength.value = v;
  }

  /** Vignette clear-center radius (default 0.35 = wide). */
  get vignetteRadius(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uVignetteRadius.value as number;
  }

  set vignetteRadius(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uVignetteRadius.value = v;
  }

  /** Day-phase saturation delta (0 = identity; +saturate, -desaturate). */
  get gradeSaturation(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeSat.value as number;
  }

  set gradeSaturation(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeSat.value = v;
  }

  /** Day-phase warmth delta (0 = identity; +warm red up/blue down). */
  get gradeWarmth(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeWarm.value as number;
  }

  set gradeWarmth(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeWarm.value = v;
  }

  /** Day-phase lift delta (0 = identity; +raises crushed blacks). */
  get gradeLift(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeLift.value as number;
  }

  set gradeLift(v: number) {
    (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGradeLift.value = v;
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

  /**
   * Drive the per-frame 159 sun-effect uniforms in one call. `u`/`v` are the
   * projected sun screen uv (per view), `front` is the smooth [0,1] front-facing
   * weight that scales every effect (0 behind the camera, fading in across the
   * screen-edge crossover so nothing pops), `aspect` keeps the halo/ghosts
   * round, `color` is the sRGB sun tint, and the three gains (already day-phase
   * + tier scaled; 0 = the effect is off) select each effect. Gains at 0 leave
   * the pass a byte-identical no-op.
   */
  setSunEffects(
    u: number,
    v: number,
    front: number,
    aspect: number,
    color: THREE.Color,
    halo: number,
    godray: number,
    flare: number,
  ): void {
    const uni = (this.fsQuad.material as THREE.ShaderMaterial).uniforms;
    (uni.uSunUv.value as THREE.Vector2).set(u, v);
    uni.uSunFront.value = front;
    uni.uAspect.value = aspect;
    (uni.uSunColor.value as THREE.Color).copy(color);
    uni.uHaloIntensity.value = halo;
    uni.uGodrayIntensity.value = godray;
    uni.uFlareIntensity.value = flare;
  }

  /** Current sun-halo gain (0 = off). Test/inspection accessor. */
  get haloIntensity(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uHaloIntensity.value as number;
  }

  /** Current god-ray gain (0 = off). Test/inspection accessor. */
  get godrayIntensity(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uGodrayIntensity.value as number;
  }

  /** Current lens-flare gain (0 = off). Test/inspection accessor. */
  get flareIntensity(): number {
    return (this.fsQuad.material as THREE.ShaderMaterial).uniforms.uFlareIntensity.value as number;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget | null,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // Composite: posterize sky pixels (masked by the shared layers-0+1 tDepth),
    // pass through everything else.
    const m = this.fsQuad.material as THREE.ShaderMaterial;
    m.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose(): void {
    (this.fsQuad.material as THREE.Material).dispose();
    this.fsQuad.dispose();
  }
}
