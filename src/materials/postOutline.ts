import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Override material that writes view-space normals (packed to [0,1]) into the
 * color attachment. Used by PostOutlinePass to capture terrain (layer 1)
 * geometry for Sobel edge detection.
 */
const NORMAL_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const NORMAL_FRAG = /* glsl */ `
  varying vec3 vN;
  void main() {
    gl_FragColor = vec4(vN * 0.5 + 0.5, 1.0);
  }
`;

const SOBEL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SOBEL_FRAG = /* glsl */ `
  uniform sampler2D tColor;   // composer readBuffer (LINEAR, full scene)
  uniform sampler2D tNormal;  // terrain view-space normal (packed [0,1])
  uniform sampler2D tDepth;   // terrain window-space depth [0,1], 1.0 = cleared
  uniform vec2 uTexel;
  uniform vec3 uLineColor;
  uniform float uEdgeStrength;
  uniform float uNormalThreshold;
  uniform float uDepthThreshold;

  varying vec2 vUv;

  vec3 decodeNormal(vec2 uv) {
    return texture2D(tNormal, uv).rgb * 2.0 - 1.0;
  }

  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;
    float depth = texture2D(tDepth, vUv).r;

    // Sky / non-terrain (cleared far depth) is excluded from the outline pass.
    if (depth >= 0.999) {
      gl_FragColor = vec4(color, 1.0);
      return;
    }

    vec2 ox = vec2(uTexel.x, 0.0);
    vec2 oy = vec2(0.0, uTexel.y);

    vec3 nL = decodeNormal(vUv - ox);
    vec3 nR = decodeNormal(vUv + ox);
    vec3 nD = decodeNormal(vUv - oy);
    vec3 nU = decodeNormal(vUv + oy);
    float nEdge = max(length(nR - nL), length(nU - nD));

    float dL = texture2D(tDepth, vUv - ox).r;
    float dR = texture2D(tDepth, vUv + ox).r;
    float dD = texture2D(tDepth, vUv - oy).r;
    float dU = texture2D(tDepth, vUv + oy).r;
    float dEdge = max(abs(dR - dL), abs(dU - dD));

    float edge = 0.0;
    if (nEdge > uNormalThreshold) edge = 1.0;
    if (dEdge > uDepthThreshold) edge = 1.0;
    edge *= uEdgeStrength;

    gl_FragColor = vec4(mix(color, uLineColor, edge), 1.0);
  }
`;

export interface PostOutlineOpts {
  lineColor?: number;
  edgeStrength?: number;
  normalThreshold?: number;
  depthThreshold?: number;
}

/**
 * Post-process toon outline for large surfaces (terrain + walls, layer 1).
 * Renders ONLY layer-1 geometry into a normal+depth render target (DepthTexture),
 * then runs a Sobel edge detect on normal + depth and composites pure-black
 * lines over the composer's color buffer, masked to terrain pixels. Sky and
 * solid props (layer 0, already covered by inverted-hull outlines) are
 * excluded. Operates entirely in LINEAR space; OutputPass applies tone mapping.
 */
export class PostOutlinePass extends Pass {
  readonly normalDepthRT: THREE.WebGLRenderTarget;
  readonly normalMaterial: THREE.ShaderMaterial;

  private readonly scene: THREE.Scene;
  /**
   * Camera the terrain normal/depth pre-pass renders with. Public + mutable so
   * Renderer can rebind the active camera each frame (menu cam vs chase cam);
   * render() saves/restores this camera's layer mask around the pre-pass.
   */
  camera: THREE.Camera;
  private readonly fsQuad: FullScreenQuad;
  private savedLayersMask = 1;
  private readonly savedClearColor = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width = 1024,
    height = 1024,
    opts: PostOutlineOpts = {},
  ) {
    super();
    this.scene = scene;
    this.camera = camera;

    this.normalDepthRT = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.normalDepthRT.depthTexture = depthTexture;

    this.normalMaterial = new THREE.ShaderMaterial({
      vertexShader: NORMAL_VERT,
      fragmentShader: NORMAL_FRAG,
    });

    this.fsQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null as THREE.Texture | null },
          tNormal: { value: this.normalDepthRT.texture },
          tDepth: { value: this.normalDepthRT.depthTexture },
          uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
          uLineColor: { value: new THREE.Color(opts.lineColor ?? 0x000000) },
          uEdgeStrength: { value: opts.edgeStrength ?? 1.0 },
          uNormalThreshold: { value: opts.normalThreshold ?? 0.3 },
          uDepthThreshold: { value: opts.depthThreshold ?? 0.001 },
        },
        vertexShader: SOBEL_VERT,
        fragmentShader: SOBEL_FRAG,
      }),
    );
  }

  setSize(width: number, height: number): void {
    this.normalDepthRT.setSize(width, height);
    const m = this.fsQuad.material as THREE.ShaderMaterial;
    (m.uniforms.uTexel.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget | null,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    // 1) Capture terrain (layer 1) normal + depth into normalDepthRT.
    this.savedLayersMask = this.camera.layers.mask;
    this.camera.layers.set(1); // terrain layer only
    const prevOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.normalMaterial;
    renderer.getClearColor(this.savedClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.normalDepthRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.savedClearColor, prevClearAlpha);
    this.scene.overrideMaterial = prevOverride;
    this.camera.layers.mask = this.savedLayersMask;

    // 2) Composite Sobel edges over the main color buffer.
    const m = this.fsQuad.material as THREE.ShaderMaterial;
    m.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose(): void {
    this.normalDepthRT.dispose();
    this.normalMaterial.dispose();
    (this.fsQuad.material as THREE.Material).dispose();
    this.fsQuad.dispose();
  }
}
