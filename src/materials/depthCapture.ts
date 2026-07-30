import * as THREE from "three";
import { Pass } from "three/addons/postprocessing/Pass.js";
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

  private readonly scene: THREE.Scene;
  /**
   * Camera the non-sky depth pre-pass renders with. Public + mutable so
   * Renderer can rebind the active camera each frame (menu cam vs chase cam);
   * render() saves/restores this camera's layer mask around the pre-pass.
   */
  camera: THREE.Camera;
  private savedLayersMask = 0;
  private readonly savedClearColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera, width = 1024, height = 1024) {
    super();
    this.scene = scene;
    this.camera = camera;
    // Depth-only capture: renders into its private depthRT and must NOT
    // disturb the composer color read/write buffers.
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
    _writeBuffer: THREE.WebGLRenderTarget | null,
    _readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // Capture combined layers-0+1 depth (props/karts/weather + terrain/walls/
    // water) so sky shows as the cleared far plane. One pre-pass over
    // nonSkyLayersMask (0b011) feeds both the sky mask and the god-ray march.
    this.savedLayersMask = this.camera.layers.mask;
    this.camera.layers.mask = this.nonSkyLayersMask;
    const prevOverride = this.scene.overrideMaterial;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const restoreVisibility = suppressNonDepthWritingObjects(this.scene);
    try {
      this.scene.overrideMaterial = this.depthMaterial;
      renderer.setRenderTarget(this.depthRT);
      // packDepthToRGBA(1.0) is vec4(1), so white is the cleared far plane.
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    } finally {
      restoreVisibility();
      this.scene.overrideMaterial = prevOverride;
      this.camera.layers.mask = this.savedLayersMask;
      renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    }
  }

  dispose(): void {
    this.depthRT.dispose();
    this.depthMaterial.dispose();
  }
}
