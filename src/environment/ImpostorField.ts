import * as THREE from "three";
import { ImpostorMaterial, impostorAtlasLayout, impostorCellRect } from "../materials/impostor";
import type { AtlasLayout } from "../materials/impostor";
import type { PlacedProp } from "./propSampler";

/**
 * Runtime-baked foliage impostors (200): GL owner side.
 *
 * `bakeImpostorAtlas` renders each distinct big-flora prototype ONCE into an
 * albedo + normal RenderTarget atlas (procedural, never a committed texture),
 * capturing material inputs (LINEAR base colour + silhouette, packed side-view
 * normal) rather than final lighting. `ImpostorField` then draws a chunk's big
 * placements as instanced yaw-billboard quads sampling that atlas, relit each
 * frame by ImpostorMaterial via the shared light uniforms + cel bands + fog.
 *
 * No colliders: this class never touches physics. It is the cheap far-LOD
 * substitute for PropField's merged 3D meshes past an impostor-start radius;
 * the swap is cross-dissolved via the shared `uFade` dither (setFade).
 *
 * The bake (bakeImpostorAtlas) needs a live WebGL2 context and is therefore
 * RUNTIME-ONLY / not exercised by the jsdom+node test suites. The atlas LAYOUT
 * math (materials/impostor.ts), the billboard shader strings, and the instance
 * placement/fade below are pure and unit-tested with a stub atlas.
 */

/** Per-prototype baked cell metadata: atlas index + world card dimensions. */
export interface ImpostorCell {
  /** World card width (max horizontal extent) at unit scale. */
  width: number;
  /** World card height (vertical extent) at unit scale. */
  height: number;
}

/** Baked atlas handle consumed by ImpostorField + the streaming swap. */
export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  layout: AtlasLayout;
  /** Per-prototype (cell index -> world card size at unit scale). */
  cells: ImpostorCell[];
  /** Map a flora kind to its atlas cell index (-1 if the kind was not baked). */
  cellForKind(kind: string): number;
  /** Free the two RenderTarget textures. */
  dispose(): void;
}

/** One prototype to bake: its kind + a world-authored (base-at-0) geometry. */
export interface ImpostorPrototype {
  kind: string;
  /** Geometry carrying a LINEAR `color` attribute (flora build output). */
  geometry: THREE.BufferGeometry;
}

export interface BakeAtlasOptions {
  /** Pixel size of one square atlas cell. Default 128. */
  cellPixels?: number;
}

// Encodes the geometry's view-space normal into rgb (n * 0.5 + 0.5). The bake
// camera looks along -Z at the prototype, so view space is exactly the card
// frame ImpostorMaterial reconstructs (x=right, y=up, z=toward camera).
const NORMAL_BAKE_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const NORMAL_BAKE_FRAG = /* glsl */ `
  varying vec3 vN;
  void main() {
    gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
  }
`;

/**
 * RUNTIME-ONLY. Bake `prototypes` into an albedo + normal atlas. Each cell is
 * an orthographic side view (looking along -Z) framed to the prototype's
 * bounding box; the albedo pass draws the vertex-colour base (unlit) with a
 * transparent clear so alpha = silhouette coverage, and the normal pass writes
 * the packed view normal. Cell rects come from the pure impostorAtlasLayout /
 * impostorCellRect so the render viewports and the instance UVs agree.
 *
 * Needs a live WebGL2 renderer; not called under the test suites.
 */
export function bakeImpostorAtlas(
  renderer: THREE.WebGLRenderer,
  prototypes: ImpostorPrototype[],
  opts: BakeAtlasOptions = {},
): ImpostorAtlas {
  const cellPixels = opts.cellPixels ?? 128;
  const layout = impostorAtlasLayout(prototypes.length);
  const w = layout.cols * cellPixels;
  const h = layout.rows * cellPixels;
  const rtOpts: THREE.RenderTargetOptions = {
    depthBuffer: true,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  };
  const albedoRT = new THREE.WebGLRenderTarget(w, h, rtOpts);
  const normalRT = new THREE.WebGLRenderTarget(w, h, rtOpts);

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  const albedoMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const normalMat = new THREE.ShaderMaterial({
    vertexShader: NORMAL_BAKE_VERT,
    fragmentShader: NORMAL_BAKE_FRAG,
  });
  const mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = new THREE.Mesh(
    new THREE.BufferGeometry(),
    albedoMat,
  );
  scene.add(mesh);

  const cells: ImpostorCell[] = [];
  const kindToCell = new Map<string, number>();

  const prevRT = renderer.getRenderTarget();
  const prevScissorTest = renderer.getScissorTest();
  renderer.setScissorTest(true);

  // Transparent clears so untouched atlas texels stay fully cut out.
  bakePass(renderer, albedoRT, () => {
    for (let i = 0; i < prototypes.length; i++) {
      const p = prototypes[i]!;
      const box = new THREE.Box3().setFromBufferAttribute(
        p.geometry.getAttribute("position") as THREE.BufferAttribute,
      );
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const halfW = Math.max(size.x, size.z) * 0.5 || 0.5;
      const halfH = size.y * 0.5 || 0.5;
      frameCamera(cam, center, halfW, halfH);
      mesh.geometry = p.geometry;
      mesh.material = albedoMat;
      renderCell(renderer, layout, i, cellPixels, scene, cam);
      cells[i] = { width: Math.max(size.x, size.z), height: size.y };
      kindToCell.set(p.kind, i);
    }
  });
  bakePass(renderer, normalRT, () => {
    for (let i = 0; i < prototypes.length; i++) {
      const p = prototypes[i]!;
      const box = new THREE.Box3().setFromBufferAttribute(
        p.geometry.getAttribute("position") as THREE.BufferAttribute,
      );
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      frameCamera(cam, center, Math.max(size.x, size.z) * 0.5 || 0.5, size.y * 0.5 || 0.5);
      mesh.geometry = p.geometry;
      mesh.material = normalMat;
      renderCell(renderer, layout, i, cellPixels, scene, cam);
    }
  });

  renderer.setScissorTest(prevScissorTest);
  renderer.setRenderTarget(prevRT);
  albedoMat.dispose();
  normalMat.dispose();

  return {
    albedo: albedoRT.texture,
    normal: normalRT.texture,
    layout,
    cells,
    cellForKind: (kind) => kindToCell.get(kind) ?? -1,
    dispose: () => {
      albedoRT.dispose();
      normalRT.dispose();
    },
  };
}

function bakePass(
  renderer: THREE.WebGLRenderer,
  rt: THREE.WebGLRenderTarget,
  draw: () => void,
): void {
  renderer.setRenderTarget(rt);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.setScissorTest(true);
  draw();
}

function frameCamera(
  cam: THREE.OrthographicCamera,
  center: THREE.Vector3,
  halfW: number,
  halfH: number,
): void {
  cam.left = -halfW;
  cam.right = halfW;
  cam.top = halfH;
  cam.bottom = -halfH;
  cam.near = 0.01;
  cam.far = Math.max(halfW, halfH) * 8 + 100;
  cam.position.set(center.x, center.y, center.z + cam.far * 0.5);
  cam.up.set(0, 1, 0);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}

function renderCell(
  renderer: THREE.WebGLRenderer,
  layout: AtlasLayout,
  index: number,
  cellPixels: number,
  scene: THREE.Scene,
  cam: THREE.Camera,
): void {
  const rect = impostorCellRect(index, layout);
  const px = Math.round(rect.u0 * layout.cols * cellPixels);
  const py = Math.round(rect.v0 * layout.rows * cellPixels);
  renderer.setViewport(px, py, cellPixels, cellPixels);
  renderer.setScissor(px, py, cellPixels, cellPixels);
  renderer.render(scene, cam);
}

/**
 * Instanced yaw-billboard field for one chunk's big placements (200). Builds a
 * single InstancedMesh of unit quads (one draw call) sampling the shared atlas,
 * sized + UV-mapped per instance from the atlas cells. NO colliders and NO
 * physics. `setFade` drives the shared dither cross-dissolve; `dispose` frees
 * the geometry + material (NOT the shared atlas — the owner disposes that).
 */
export class ImpostorField {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh | null;
  private readonly material: ImpostorMaterial | null;
  private disposed = false;

  constructor(placements: readonly PlacedProp[], atlas: ImpostorAtlas) {
    // Only placements whose kind was baked into the atlas become cards.
    const drawn = placements.filter((p) => atlas.cellForKind(p.kind) >= 0);
    if (drawn.length === 0) {
      this.mesh = null;
      this.material = null;
      return;
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    const material = new ImpostorMaterial({ albedo: atlas.albedo, normal: atlas.normal });
    const mesh = new THREE.InstancedMesh(geo, material, drawn.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const aSize = new Float32Array(drawn.length * 2);
    const aUv = new Float32Array(drawn.length * 4);
    const m = new THREE.Matrix4();
    for (let i = 0; i < drawn.length; i++) {
      const p = drawn[i]!;
      const cellIdx = atlas.cellForKind(p.kind);
      const cell = atlas.cells[cellIdx]!;
      const rect = impostorCellRect(cellIdx, atlas.layout);
      aSize[i * 2] = cell.width * p.scale;
      aSize[i * 2 + 1] = cell.height * p.scale;
      aUv[i * 4] = rect.u0;
      aUv[i * 4 + 1] = rect.v0;
      aUv[i * 4 + 2] = rect.du;
      aUv[i * 4 + 3] = rect.dv;
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
    }
    geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(aSize, 2));
    geo.setAttribute("aUv", new THREE.InstancedBufferAttribute(aUv, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.mesh = mesh;
    this.material = material;
    this.group.add(mesh);
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  /** Number of billboard instances (0 when no placement kind was baked). */
  get count(): number {
    return this.mesh?.count ?? 0;
  }

  /** Dither-fade the impostor cards (0 = dissolved, 1 = solid). */
  setFade(v: number): void {
    if (this.material) this.material.uniforms.uFade.value = v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.group.clear();
  }
}
