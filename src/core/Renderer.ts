import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Sun elevation/azimuth (degrees). Single source of truth shared by the Sky
// shader and the directional light so the visible sun disc and shadow
// direction always agree.
const SUN_ELEVATION = 28;
const SUN_AZIMUTH = 135;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly sunDirection = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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

    // Compute sun direction once.
    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    this.sunDirection.setFromSphericalCoords(1, phi, theta);

    // Procedural Preetham atmosphere sky dome.
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u['turbidity'].value = 8;
    u['rayleigh'].value = 1.6;
    u['mieCoefficient'].value = 0.005;
    u['mieDirectionalG'].value = 0.8;
    u['sunPosition'].value.copy(this.sunDirection);
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
    // Place the light along the sun direction (relative to the kart) so
    // shadows stay aligned with the visible sun as the target follows the kart.
    const d = 160;
    this.sun.position.set(x + this.sunDirection.x * d, this.sunDirection.y * d, z + this.sunDirection.z * d);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}
