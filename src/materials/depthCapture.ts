import * as THREE from "three";
import { Pass } from "three/addons/postprocessing/Pass.js";

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

/**
 * Shared non-sky depth pre-pass for a composer view slot. Renders the combined
 * layers-0+1 scene (props/karts/weather + terrain/walls/water) with an opaque
 * depth-only override material into a private {@link depthRT}, so any consumer
 * can read one authoritative scene-depth handle ({@link depthTexture}) instead
 * of self-capturing its own copy.
 *
 * Extracted from SkyPosterizePass's former "step 1": the captured content is
 * byte-identical (same {@link nonSkyLayersMask} = 0b011, same opaque override
 * material writing vec4(0.0, 0.0, 0.0, 1.0), same clear/render sequence), so
 * render output is unchanged. Sky (layer 2) is excluded, leaving those pixels
 * at the cleared far plane (depth 1.0). This pass is depth-only — no MRT
 * normals; no consumer needs normals yet.
 *
 * `needsSwap = false`: it renders only into its private depthRT and never
 * touches the composer color read/write buffers.
 */
export class DepthCapturePass extends Pass {
  readonly depthRT: THREE.WebGLRenderTarget;
  readonly depthMaterial: THREE.ShaderMaterial;
  /**
   * Camera layer mask the depth pre-pass renders. 0b011 = layers 0 (solid
   * props/karts/weather) AND 1 (terrain/walls/water), captured into one
   * combined depth buffer. Sky on layer 2 is excluded, so it stays at the
   * cleared far plane (depth 1.0). Weather lives on layer 0 with
   * depthWrite:false in the main color pass, but the opaque depth-only
   * override material here still writes its depth, so it reads as non-sky.
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
  }

  /**
   * Shared scene-depth handle consumers read (combined layers-0+1). Sky pixels
   * stay at the cleared far plane (depth 1.0).
   */
  get depthTexture(): THREE.DepthTexture {
    return this.depthRT.depthTexture as THREE.DepthTexture;
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
  }

  dispose(): void {
    this.depthRT.dispose();
    this.depthMaterial.dispose();
  }
}
