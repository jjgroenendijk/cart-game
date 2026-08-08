import * as THREE from "three";
import { Pass } from "postprocessing";
import { DEFAULT_MIST_PARAMS, MIST_NOISE_FN, type GroundMistParams } from "./groundMistMath";

const MIST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 228 valley mist fragment. #define MIST_OCTAVES must equal
// DEFAULT_MIST_PARAMS.octaves (3). The shared fbm is inlined via
// MIST_NOISE_FN so the shader is self-contained (no include path).
const MIST_FRAG = /* glsl */ `
  #define MIST_OCTAVES 3
  #include <packing>

  // sRGB post-tonemap color from the composer readBuffer (OutputPass output),
  // same stage SkyPosterize composites on.
  uniform sampler2D tColor;
  // Combined layers-0+1 depth (props/karts/weather + terrain/walls/water)
  // from the shared DepthCapturePass. Cleared to 1.0, so sky stays 1.0.
  uniform sampler2D tDepth;
  // 228: precomputed camera.matrixWorld * camera.projectionMatrixInverse,
  // refreshed per frame in render() from this.camera. Unprojects the
  // sampled depth back to a world position so the haze can key on Y.
  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos;
  // 228: master gain 0..1 (tier strength x user enable). DEFAULT 0 -> the
  // whole effect is a byte-identical no-op: color is sampled then returned
  // unchanged before any per-pixel work (see identity early-out in main).
  uniform float uMistStrength;
  uniform vec3 uFogColor;     // sRGB fog tint (Renderer converts linear->sRGB)
  uniform float uTimeFactor;  // 228 dawn/dusk-peaked day weight (mistTimeFactor)
  uniform float uWetness;     // weather wetness 0..1 (humidity proxy)
  uniform float uTime;        // monotonic seconds (drives fbm domain scroll)
  uniform float uDepthEps;    // depth == 1.0 tolerance (matches SkyPosterize)
  uniform float uPoolY;
  uniform float uThinY;
  uniform float uNearFadeStart;
  uniform float uNearFadeEnd;
  uniform float uFbmScale;
  uniform float uDriftSpeed;
  uniform float uDensityScale;

  varying vec2 vUv;

  ${MIST_NOISE_FN}

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float depth = unpackRGBAToDepth(texture2D(tDepth, vUv));

    // 228: identity early-out. uMistStrength <= 0 (low tier / user off) ->
    // exact pre-228 frame, no per-pixel work past the two texture fetches.
    if (uMistStrength <= 0.0) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    // 228: sky skip. The shared depth buffer clears sky to 1.0; mist never
    // paints the sky (it keeps its own gradient + distance fog). Matches the
    // SkyPosterize sky-mask tolerance.
    if (depth >= 1.0 - uDepthEps) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    // 228: reconstruct world position from the non-sky depth pixel.
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 world = uInvViewProj * ndc;
    world.xyz /= world.w;

    // 228: altitude falloff. 1 at/below uPoolY (valleys/basins/water edges),
    // 0 at/above uThinY (track/kart corridor clears). thinY (default +2) is
    // above the racing line, so the haze pools low and never hides the track.
    float alt = smoothstep(uThinY, uPoolY, world.y);
    if (alt <= 0.0) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    // 228: distance fade so close karts are never hidden. 0 within
    // uNearFadeStart, 1 beyond uNearFadeEnd -> haze fades in only past the
    // near cockpit/kart bubble.
    float dist = length(world.xyz - uCamPos);
    float distFade = smoothstep(uNearFadeStart, uNearFadeEnd, dist);

    // 228: fbm drift on world XZ. The domain scrolls with uTime for slow
    // lateral haze motion; uFbmScale sets patch size (lower = bigger drifts).
    vec2 p = world.xz * uFbmScale + vec2(uTime * uDriftSpeed);
    float n = fbm(p, MIST_OCTAVES);
    float mottle = 0.6 + 0.4 * n;

    // 228: final density. multiplies the dawn/dusk time weight, the humidity
    // boost (1.0 + 0.6 * wetness, mirrors mistWetnessBoost exactly), the tier
    // + user gain, and the master look multiplier.
    float density = alt * distFade * mottle;
    density *= uTimeFactor;
    density *= (1.0 + 0.6 * clamp(uWetness, 0.0, 1.0));
    density *= uMistStrength;
    density *= uDensityScale;
    density = clamp(density, 0.0, 1.0);

    // 228: composite toward the fog tint. Mist reads as lightened, tinted air
    // matching the scene's distance fog so it never clashes with the palette.
    color = mix(color, uFogColor, density);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * 228 volumetric ground mist (valley mist) post-process pass. Screen-space,
 * height-based: for each non-sky pixel it unprojects the shared
 * DepthCapturePass depth back to world space, then pools a fbm-driven haze
 * below thinY (densest at/below poolY), fades it in past the near kart bubble,
 * and composites toward the fog tint. No raymarch, no extra scene render — it
 * reuses the single shared layers-0+1 depth texture, so the cost is one
 * full-screen fbm + unproject per pixel (holds 60fps).
 *
 * Behavior: pools in valleys/basins/water edges, thins with altitude, densest
 * at dawn/dusk (uTimeFactor from mistTimeFactor), tinted to the current fog
 * color, and never hides the track or nearby karts (thinY above the racing
 * line + a near-distance fade). Identity at uMistStrength = 0 (low tier off
 * via a uniform gain of 0 -> byte-identical to pre-228), and sky pixels are
 * skipped (depth 1.0) so the sky gradient is untouched.
 *
 * Placement: runs AFTER OutputPass in the composer chain (post-tonemap sRGB),
 * alongside SkyPosterize as a final atmosphere layer. needsSwap stays true
 * (Pass default): it reads readBuffer and writes writeBuffer.
 */
export class GroundMistPass extends Pass {
  /**
   * Camera the per-frame unproject uniforms read. Public + mutable so the
   * Renderer can rebind the active camera each frame (menu cam vs chase cam),
   * matching DepthCapturePass. Named viewCamera to avoid collision with the
   * inherited protected Pass.camera (used for the fullscreen triangle render).
   */
  viewCamera: THREE.Camera = new THREE.PerspectiveCamera();

  private readonly _invViewProj = new THREE.Matrix4();

  constructor(depthTexture: THREE.Texture, opts: Partial<GroundMistParams> = {}) {
    super("GroundMistPass");

    const p: GroundMistParams = { ...DEFAULT_MIST_PARAMS, ...opts };

    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null as THREE.Texture | null },
        tDepth: { value: depthTexture as THREE.Texture },
        uInvViewProj: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        // 228: neutral-by-default master gain. 0 -> byte-identical identity
        // (Renderer wires the tier-resolved strength per frame).
        uMistStrength: { value: 0 },
        uFogColor: { value: new THREE.Color(1, 1, 1) },
        uTimeFactor: { value: 0 },
        uWetness: { value: 0 },
        uTime: { value: 0 },
        uDepthEps: { value: 1e-4 },
        uPoolY: { value: p.poolY },
        uThinY: { value: p.thinY },
        uNearFadeStart: { value: p.nearFadeStart },
        uNearFadeEnd: { value: p.nearFadeEnd },
        uFbmScale: { value: p.fbmScale },
        uDriftSpeed: { value: p.driftSpeed },
        uDensityScale: { value: p.densityScale },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
    });
  }

  /** Current master mist gain (0 = identity/off). Test/inspection accessor. */
  get mistStrength(): number {
    return (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms.uMistStrength.value as number;
  }

  /**
   * Drive the per-frame non-camera mist uniforms in one call (mirrors
   * SkyPosterizePass.setSunEffects). `strength` is already tier x enable
   * resolved by the Renderer (0 = off, byte-identical identity), `fogColorSrgb`
   * is the sRGB-converted fog tint, `timeFactor` is mistTimeFactor's result,
   * and `wetness` is the shared weather wetness channel.
   */
  setMist(
    time: number,
    strength: number,
    fogColorSrgb: THREE.Color,
    timeFactor: number,
    wetness: number,
  ): void {
    const uni = (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms;
    uni.uTime.value = time;
    uni.uMistStrength.value = strength;
    (uni.uFogColor.value as THREE.Color).copy(fogColorSrgb);
    uni.uTimeFactor.value = timeFactor;
    uni.uWetness.value = wetness;
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    const m = this.fullscreenMaterial as THREE.ShaderMaterial;
    m.uniforms.tColor.value = inputBuffer!.texture;

    this.viewCamera.updateMatrixWorld();
    this._invViewProj
      .copy(this.viewCamera.matrixWorld)
      .multiply(this.viewCamera.projectionMatrixInverse);
    (m.uniforms.uInvViewProj.value as THREE.Matrix4).copy(this._invViewProj);
    (m.uniforms.uCamPos.value as THREE.Vector3).copy(this.viewCamera.position);

    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    (this.fullscreenMaterial as THREE.Material).dispose();
  }
}
