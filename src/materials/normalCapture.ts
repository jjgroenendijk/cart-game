import * as THREE from "three";
import { Pass } from "postprocessing";
import { suppressNonDepthWritingObjects } from "./captureVisibility";

/**
 * Shared non-sky view-space normal pre-pass for a composer view slot. Renders
 * the combined layers-0+1 scene (props/karts/weather + terrain/walls/water)
 * with Three's MeshNormalMaterial into a private RGBA8 {@link normalRT},
 * packing each fragment's view-space normal into [0,1] RGB. Consumers (GTAO,
 * issue #235) read one authoritative scene-normal handle ({@link normalTexture})
 * instead of self-capturing their own copy.
 *
 * Mirrors {@link DepthCapturePass} in structure: same {@link nonSkyLayersMask}
 * = 0b011, same suppression of original `depthWrite:false` drawables, same
 * save/restore of camera layer mask + override material + clear color/alpha,
 * and the same single opaque render of the non-sky scene. Sky (layer 2) is
 * excluded, leaving those pixels at the clear color, which encodes the
 * toward-camera normal (0,0,1) packed -> (0.5, 0.5, 1.0); gaps/impostor-less
 * pixels likewise read back as toward-camera -> minimal occlusion, safe.
 *
 * MeshNormalMaterial is load-bearing: its standard vertex chunks apply
 * instancing/batching/morph transforms to both position and normal. The former
 * custom shader transformed an instance normal but not its vertex position, so
 * instanced clouds/props wrote normals at the object origin.
 *
 * The captured view-space normal is approximate for terrain: terrain's shaded
 * normal is per-fragment from a heightmap in CelMaterial, whereas here we use
 * the geometry vertex normal transformed by `normalMatrix`. That is close
 * enough for AO and is an accepted tradeoff documented in the design.
 *
 * {@link normalRT} is RGBA8 + Nearest-filtered to align pixel-for-pixel with
 * the shared packed-depth buffer. Eight-bit packed normals are sufficient for
 * the low-slice GTAO pass and avoid an extra HalfFloat render-target path on
 * mobile Safari.
 *
 * `needsSwap = false`: it renders only into its private normalRT and never
 * touches the composer color read/write buffers.
 */
export class NormalCapturePass extends Pass {
  readonly normalRT: THREE.WebGLRenderTarget;
  readonly normalMaterial: THREE.MeshNormalMaterial;
  /**
   * Camera layer mask the normal pre-pass renders. 0b011 = layers 0 (solid
   * props/karts/weather) AND 1 (terrain/walls/water), captured into one
   * combined normal buffer. Sky on layer 2 is excluded, so it stays at the
   * clear color (toward-camera normal). Original depthWrite:false drawables
   * remain excluded from the override render.
   */
  nonSkyLayersMask = 0b011;

  private savedLayersMask = 0;
  private readonly savedClearColor = new THREE.Color();
  /**
   * Clear color = view-space toward-camera normal (0,0,1) packed into [0,1]
   * -> (0.5, 0.5, 1.0). Any pixel with no geometry (sky / gaps / impostors
   * missing normals) reads back as toward-camera -> minimal occlusion, safe.
   */
  private readonly clearNormal = new THREE.Color(0.5, 0.5, 1.0);

  constructor(scene: THREE.Scene, camera: THREE.Camera, width = 1024, height = 1024) {
    super("NormalCapturePass", scene, camera);
    this.needsSwap = false;

    this.normalRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    this.normalRT.texture.colorSpace = THREE.NoColorSpace;

    this.normalMaterial = new THREE.MeshNormalMaterial({
      blending: THREE.NoBlending,
    });
  }

  /**
   * Shared scene-normal handle consumers read (combined layers-0+1), a packed
   * view-space normal in [0,1] RGB. Stable across setSize: the underlying
   * texture instance is kept, so consumers' binding survives a resize.
   */
  get normalTexture(): THREE.Texture {
    return this.normalRT.texture;
  }

  setSize(width: number, height: number): void {
    this.normalRT.setSize(width, height);
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
      scene.overrideMaterial = this.normalMaterial;
      renderer.setRenderTarget(this.normalRT);
      renderer.setClearColor(this.clearNormal, 1);
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
    this.normalRT.dispose();
    this.normalMaterial.dispose();
  }
}
