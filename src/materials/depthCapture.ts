import * as THREE from "three";
import { Pass } from "postprocessing";
import { suppressNonDepthWritingObjects } from "./captureVisibility";

/**
 * Shared non-sky depth pre-pass for a composer view slot. Renders the combined
 * layers-0+1 scene (props/karts/weather + terrain/walls/water) with an opaque
 * RGBADepthPacking override material into a private RGBA8 {@link depthRT}, so
 * any consumer can read one authoritative packed-depth handle ({@link
 * depthTexture}) instead of self-capturing its own copy.
 *
 * Packed RGBA8 deliberately avoids sampling a native DepthTexture attachment:
 * the latter can return tiled/corrupt samples on iOS WebKit. MeshDepthMaterial
 * also applies Three's standard instancing/batching/morph vertex chunks, unlike
 * the former custom shader which rendered InstancedMesh vertices at the object
 * origin. Drawables whose original materials set `depthWrite:false` are
 * suppressed during the override render so transparent particles do not become
 * opaque depth rectangles. Sky (layer 2) is excluded, leaving those pixels at
 * the white packed far plane (depth 1.0 after unpack).
 *
 * `needsSwap = false`: it renders only into its private depthRT and never
 * touches the composer color read/write buffers.
 */
export class DepthCapturePass extends Pass {
  readonly depthRT: THREE.WebGLRenderTarget;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  /**
   * Camera layer mask the depth pre-pass renders. 0b011 = layers 0 (solid
   * props/karts/weather) AND 1 (terrain/walls/water), captured into one
   * combined depth buffer. Sky on layer 2 is excluded, so it stays at the
   * cleared far plane (depth 1.0). Weather and VFX on these layers remain
   * excluded when their original materials opt out via depthWrite:false.
   */
  nonSkyLayersMask = 0b011;

  private savedLayersMask = 0;
  private readonly savedClearColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera, width = 1024, height = 1024) {
    super("DepthCapturePass", scene, camera);
    this.needsSwap = false;

    this.depthRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    this.depthRT.texture.colorSpace = THREE.NoColorSpace;
    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      blending: THREE.NoBlending,
    });
  }

  /**
   * Shared packed scene-depth handle consumers read (combined layers-0+1).
   * Consumers unpack RGBAToDepth; sky pixels stay at the white far plane (1.0).
   */
  get depthTexture(): THREE.Texture {
    return this.depthRT.texture;
  }

  setSize(width: number, height: number): void {
    this.depthRT.setSize(width, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    _inputBuffer: THREE.WebGLRenderTarget | null,
    _outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    const scene = this.scene as THREE.Scene;
    const camera = this.camera as THREE.Camera;
    this.savedLayersMask = camera.layers.mask;
    camera.layers.mask = this.nonSkyLayersMask;
    const prevOverride = scene.overrideMaterial;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const restoreVisibility = suppressNonDepthWritingObjects(scene);
    try {
      scene.overrideMaterial = this.depthMaterial;
      renderer.setRenderTarget(this.depthRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      restoreVisibility();
      scene.overrideMaterial = prevOverride;
      camera.layers.mask = this.savedLayersMask;
      renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    }
  }

  dispose(): void {
    this.depthRT.dispose();
    this.depthMaterial.dispose();
  }
}
