import * as THREE from "three";
import { Pass } from "three/addons/postprocessing/Pass.js";

/**
 * Camera layer dedicated to genuine bloom emitters. Layers 0 (kart/props),
 * 1 (terrain/water), 2 (sky) are the visible scene; an object that should bloom
 * enables this layer IN ADDITION to its visible layer, so it draws both in the
 * main RenderPass (sharp) and here (for the bloom blur). Keeping emitters on a
 * dedicated layer is what makes the bloom SELECTIVE: only layer-3 geometry
 * reaches the emissive RT, so the raw sky dome (layer 2) and ordinary lit
 * surfaces (layers 0/1) never feed the blur (the failure mode of #310).
 */
export const EMISSIVE_LAYER = 3;

/**
 * Selective-bloom emissive pre-pass. Renders ONLY the emitter layer
 * ({@link EMISSIVE_LAYER}) of the main scene into a private HalfFloat
 * {@link emissiveRT}, cleared to black, so the downstream bloom pass blurs a
 * buffer that is black everywhere except genuine emitters (sun disc, glints).
 * Mirrors the DepthCapturePass / NormalCapturePass capture-pass shape: it owns a
 * private RT, saves/restores the camera layer mask + clear state, and sets
 * `needsSwap = false` so it never touches the composer color buffers.
 *
 * No override material: unlike depth/normal capture (geometry properties),
 * emissive is a material property, so each emitter renders with its OWN
 * material. Stage 1's only emitter is the additive SunDisc; Stage 2 adds
 * emissive-output glint variants.
 */
export class EmissiveCapturePass extends Pass {
  readonly emissiveRT: THREE.WebGLRenderTarget;

  /**
   * Camera layer mask the emissive pre-pass renders: only
   * {@link EMISSIVE_LAYER}. Set on the camera around the render then restored.
   */
  emissiveLayerMask = 1 << EMISSIVE_LAYER;

  private readonly scene: THREE.Scene;
  /**
   * Camera the emissive pre-pass renders with. Public + mutable so the Renderer
   * rebinds the active camera each frame (menu cam vs chase cam); render()
   * saves/restores this camera's layer mask around the pre-pass.
   */
  camera: THREE.Camera;
  private savedLayersMask = 0;
  private readonly savedClearColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera, width = 1024, height = 1024) {
    super();
    this.scene = scene;
    this.camera = camera;
    // Renders only into its private emissiveRT; must not swap the color buffers.
    this.needsSwap = false;

    this.emissiveRT = new THREE.WebGLRenderTarget(width, height, {
      // HalfFloat HDR so genuine >1.0 emitters keep their radiance into the blur.
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    // LINEAR: matches the composer's pre-tonemap buffer color space so the
    // bloom math + the later additive composite stay in one linear space until
    // OutputPass applies ACES + sRGB.
    this.emissiveRT.texture.colorSpace = THREE.NoColorSpace;
  }

  setSize(width: number, height: number): void {
    this.emissiveRT.setSize(width, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget | null,
    _readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.savedLayersMask = this.camera.layers.mask;
    this.camera.layers.mask = this.emissiveLayerMask;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.emissiveRT);
      // Black clear: non-emitter pixels contribute nothing to the bloom blur.
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    } finally {
      this.camera.layers.mask = this.savedLayersMask;
      renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    }
  }

  dispose(): void {
    this.emissiveRT.dispose();
  }
}
