import * as THREE from "three";
import { Pass } from "postprocessing";
import { AO_FRAG, AO_VERT } from "./ambientOcclusionShader";

export interface AmbientOcclusionParams {
  radius: number;
  floor: number;
  slices: number;
}

export const DEFAULT_AO_PARAMS: AmbientOcclusionParams = {
  radius: 0.5,
  floor: 0.25,
  slices: 4,
};

/**
 * 235 GTAO (Ground-Truth Ambient Occlusion) screen-space post-process pass.
 * Reads the shared DepthCapturePass depth + the shared NormalCapturePass
 * view-space normals, integrates per-pixel GTAO over a few screen-space
 * slices, and darkens the frame toward uAoFloor (the ambient/skylight floor)
 * rather than crushing to black. Composites in LINEAR before tonemap so the
 * multiply happens pre-tonemap (physically motivated falloff, halo-free)
 * — a deliberate deviation from the project's post-tonemap convention.
 *
 * Behavior: identity at uAoStrength = 0 (low tier off / user off -> the
 * shader samples color then returns it unchanged, byte-identical to pre-235).
 * Sky pixels are skipped (depth 1.0) so the sky gradient is untouched. Tier-
 * gated (aoStrength + aoSlices resolved in quality.ts). No temporal blend;
 * per-frame slice rotation via uFrameIndex gives a cheap quality boost.
 *
 * Placement: runs BEFORE the tonemap in the composer chain, on LINEAR HDR
 * color. needsSwap stays true (Pass default): it reads inputBuffer (LINEAR)
 * and writes outputBuffer (LINEAR).
 */
export class AmbientOcclusionPass extends Pass {
  /**
   * Camera the per-frame projection uniforms read. Public + mutable so the
   * Renderer can rebind the active camera each frame (menu cam vs chase cam),
   * matching DepthCapturePass. Initialized to a placeholder; render() refreshes
   * projectionMatrix + projectionMatrixInverse from whatever camera is bound
   * here. Named viewCamera to avoid collision with the inherited protected
   * Pass.camera (used for the fullscreen triangle render).
   */
  viewCamera: THREE.Camera = new THREE.PerspectiveCamera();

  constructor(
    depthTexture: THREE.Texture,
    normalTexture: THREE.Texture,
    opts: Partial<AmbientOcclusionParams> = {},
  ) {
    super("AmbientOcclusionPass");

    const p: AmbientOcclusionParams = { ...DEFAULT_AO_PARAMS, ...opts };

    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null as THREE.Texture | null },
        tDepth: { value: depthTexture as THREE.Texture },
        tViewNormal: { value: normalTexture },
        uProjection: { value: new THREE.Matrix4() },
        uInvProjection: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAoStrength: { value: 0 },
        uSlices: { value: p.slices },
        uRadius: { value: p.radius },
        uAoFloor: { value: p.floor },
        uDepthEps: { value: 1e-4 },
        uFrameIndex: { value: 0 },
      },
      vertexShader: AO_VERT,
      fragmentShader: AO_FRAG,
    });
  }

  /** Current master AO gain (0 = identity/off). Test/inspection accessor. */
  get aoStrength(): number {
    return (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms.uAoStrength.value as number;
  }

  /**
   * Drive the per-frame non-camera AO uniforms in one call (mirrors
   * GroundMistPass.setMist). `strength` is already tier x enable resolved by
   * the Renderer (0 = off, byte-identical identity). `slices`/`floor` are the
   * tier-resolved look params; `frameIndex` rotates slice directions for a
   * cheap quality boost.
   */
  setAo(strength: number, slices: number, floor: number, frameIndex: number): void {
    const uni = (this.fullscreenMaterial as THREE.ShaderMaterial).uniforms;
    uni.uAoStrength.value = strength;
    uni.uSlices.value = slices;
    uni.uAoFloor.value = floor;
    uni.uFrameIndex.value = frameIndex;
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    const m = this.fullscreenMaterial as THREE.ShaderMaterial;
    m.uniforms.tColor.value = inputBuffer!.texture;

    this.viewCamera.updateMatrixWorld();
    (m.uniforms.uProjection.value as THREE.Matrix4).copy(this.viewCamera.projectionMatrix);
    (m.uniforms.uInvProjection.value as THREE.Matrix4).copy(
      this.viewCamera.projectionMatrixInverse,
    );

    const dt = m.uniforms.tDepth.value as THREE.Texture;
    if (dt.image && (dt.image as { width?: number }).width) {
      const img = dt.image as { width: number; height: number };
      (m.uniforms.uResolution.value as THREE.Vector2).set(img.width, img.height);
    }

    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    (this.fullscreenMaterial as THREE.Material).dispose();
  }
}
