import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "../materials/lightUniforms";
import { PostOutlinePass } from "../materials/postOutline";
import { SkyPosterizePass } from "../materials/skyPosterize";

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: Sky;
  private composer: EffectComposer | null = null;
  private postOutline: PostOutlinePass | null = null;
  private skyPosterize: SkyPosterizePass | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Sky mesh replaces the flat background; fog blends distant terrain into
    // the horizon tint.
    this.scene.fog = new THREE.Fog(0xbcd6ea, 90, 360);

    // Single source of truth for the sun direction lives in lightUniforms
    // (world space). Sky sunPosition, DirectionalLight position, and the
    // shadow target all read from it so the visible disc and shadow vector
    // can never drift.
    const sunDirWorld = lightUniforms.uSunDirWorld.value;

    // Procedural Preetham atmosphere sky dome. Lives on layer 2 so the
    // Sobel outline pass (layer 1 only) and the sky-posterize depth mask
    // (layers 0+1) both cleanly exclude it.
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.sky.layers.set(2);
    const u = this.sky.material.uniforms;
    u["turbidity"].value = 8;
    u["rayleigh"].value = 1.6;
    u["mieCoefficient"].value = 0.005;
    u["mieDirectionalG"].value = 0.8;
    u["sunPosition"].value.copy(sunDirWorld);
    this.scene.add(this.sky);

    this.ambient = new THREE.HemisphereLight(0x9fd0ff, 0x6a7a4a, 1.0);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    const s = 80;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.setShadowTarget(0, 0);
  }

  setShadowTarget(x: number, z: number): void {
    // Place the light along the shared sun direction (relative to the kart)
    // so shadows stay aligned with the visible sun as the target follows
    // the kart.
    const d = 160;
    const sunDirWorld = lightUniforms.uSunDirWorld.value;
    sunWorldPosition(sunDirWorld, this.sun.position, d);
    this.sun.position.x += x;
    this.sun.position.z += z;
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    if (!this.composer) this.initComposer(camera);

    // See both the solid layer (0 = kart + props, inverted-hull outline),
    // the terrain layer (1 = terrain + walls, post-process Sobel outline),
    // and the sky layer (2 = sky, post posterize).
    camera.layers.enable(1);
    camera.layers.enable(2);

    // Refresh shared light uniforms once/frame so CelMaterial + outline see
    // the current sun (view space) + ambient. sunColor carries intensity;
    // ambient is the hemisphere sky/ground average.
    camera.updateMatrixWorld();
    updateLightUniforms(
      lightUniforms,
      lightUniforms.uSunDirWorld.value,
      this._sunColorLinear.copy(this.sun.color).multiplyScalar(this.sun.intensity),
      this._ambientLinear
        .copy(this.ambient.color)
        .lerp(this.ambient.groundColor, 0.5)
        .multiplyScalar(this.ambient.intensity),
      camera.matrixWorldInverse,
    );
    this.composer!.render();
  }

  /**
   * Build the EffectComposer lazily on the first render: RenderPass renders
   * the full scene LINEAR into a HalfFloat buffer (materials skip tone
   * mapping while currentRenderTarget != null), PostOutlinePass composites
   * terrain Sobel edges, OutputPass applies ACES tone mapping + sRGB, then
   * SkyPosterizePass snaps sky pixels to ~4 painted bands (Ghibli). Single
   * tone-mapping pass, no double ACES; posterize runs post-tonemap sRGB.
   */
  private initComposer(camera: THREE.Camera): void {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, camera));
    const size = this.renderer.getSize(new THREE.Vector2());
    this.postOutline = new PostOutlinePass(this.scene, camera, size.width, size.height);
    composer.addPass(this.postOutline);
    composer.addPass(new OutputPass());
    this.skyPosterize = new SkyPosterizePass(this.scene, camera, size.width, size.height);
    composer.addPass(this.skyPosterize);
    this.composer = composer;
  }

  private readonly _sunColorLinear = new THREE.Color();
  private readonly _ambientLinear = new THREE.Color();

  dispose(): void {
    this.postOutline?.dispose();
    this.skyPosterize?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
