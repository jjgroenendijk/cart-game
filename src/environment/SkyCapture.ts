import * as THREE from "three";

/**
 * 283 runtime procedural sky environment capture.
 *
 * Two-part split mirroring ImpostorField: the decision math (cadence, face
 * rotation, roughness->mip mapping, mip-count) is PURE (plain numbers/booleans,
 * no THREE types) + unit-tested under jsdom; `SkyCapture` is the RUNTIME-ONLY GL
 * owner that needs a live WebGL2 context (WebGLCubeRenderTarget + cameras) and
 * is never exercised by the test suites.
 *
 * Captures the procedural sky dome into a HalfFloat cube map so CelMaterial can
 * sample a sky-tinted ambient (assigned to lightUniforms.uSkyEnv by the
 * Renderer). Capture is LAYER 2 ONLY — the cube cameras never see terrain,
 * props, water, or karts, so there is zero feedback loop into the lit scene.
 * The sky dome is centered at origin and effectively infinitely far, so the
 * capture renders from (0,0,0).
 *
 * Zero committed media: the cube is filled each session from the live sky
 * shader, never loaded from disk. Amortized one cube face/frame (6-frame full
 * refresh) on a day-cycle cadence (default 1/64 of a cycle), plus a forced
 * full re-bake on invalidate() (weather-preset change).
 */

/** Cube faces rendered per refresh (PX, NX, PY, NY, PZ, NZ). */
export const SKY_CAPTURE_FACE_COUNT = 6;

/**
 * Cadence decision for an amortized sky bake. Returns true when the day-cycle
 * has advanced more than `thresholdFraction` of a cycle since the last bake, so
 * a refresh kicks off at most ~64x/day (6 frames each). `prevCycleT` null on
 * the first bake forces a capture. cycleT is in [0,1) and wraps at 1.0==0.0;
 * the shortest forward delta handles the seam. Pure (numbers in, boolean out).
 */
export function shouldCaptureSky(
  prevCycleT: number | null,
  currCycleT: number,
  thresholdFraction = 1 / 64,
): boolean {
  if (prevCycleT === null) return true;
  const delta = (((currCycleT - prevCycleT) % 1) + 1) % 1;
  return delta >= thresholdFraction;
}

/**
 * Next cube face index in the one-face-per-frame rotation (wraps 5 -> 0).
 * Drives the 6-frame amortized refresh: each frame renders one face, so a full
 * refresh takes exactly SKY_CAPTURE_FACE_COUNT frames. Pure.
 */
export function nextCaptureFace(currentFace: number): number {
  return (currentFace + 1) % SKY_CAPTURE_FACE_COUNT;
}

/**
 * Map a material roughness 0..1 to a cube mip level. Roughness 0 (mirror) ->
 * mip 0 (sharpest reflection); roughness 1 (fully diffuse) -> top mip
 * (blurriest). Uses round-to-nearest via floor(x+0.5) clamped to the mip range.
 * `mipCount` is the cube's mip chain length (cubeMipCount). mipCount <= 1 -> 0.
 * Pure.
 */
export function roughnessToMipLevel(roughness: number, mipCount: number): number {
  if (mipCount <= 1) return 0;
  const top = mipCount - 1;
  const level = Math.floor(roughness * top + 0.5);
  if (level < 0) return 0;
  if (level > top) return top;
  return level;
}

/**
 * Number of mips for a square cube face of `size` pixels = floor(log2(size))+1
 * for size >= 1, else 1 (e.g. 64 -> 7, 128 -> 8). Pure.
 */
export function cubeMipCount(size: number): number {
  if (size < 1) return 1;
  return Math.floor(Math.log2(size)) + 1;
}

/** Cube face look/up directions (PX, NX, PY, NY, PZ, NZ) per THREE's WebGL CS. */
const FACE_DIRS: ReadonlyArray<{
  look: THREE.Vector3;
  up: THREE.Vector3;
}> = [
  { look: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  { look: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  { look: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  { look: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { look: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { look: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
];

/** Sky dome + sun/moon/stars layer (matches Renderer.ts sky.layers.set(2)). */
const SKY_LAYER = 2;

/**
 * RUNTIME-ONLY. Owns the WebGLCubeRenderTarget filled from the live sky shader
 * and amortizes a full 6-face refresh one face per frame on a day-cycle
 * cadence. The captured CubeTexture is read by `texture` and assigned by the
 * Renderer to lightUniforms.uSkyEnv. Needs a live WebGL2 context; not unit
 * tested (no WebGL under jsdom).
 *
 * Single-face rendering uses renderer.setRenderTarget(rt, faceIndex) +
 * renderer.render(scene, faceCam) — the same path THREE's CubeCamera.update
 * uses per face — so the amortization is robust across three versions. The
 * CubeCamera is the conventional RT owner + scene-graph node (added to the
 * scene so its transform is part of the graph); the faceCameras do the actual
 * per-face rendering (CubeCamera.update renders all 6 at once).
 */
export class SkyCapture {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly _size: number;
  private readonly renderTarget: THREE.WebGLCubeRenderTarget | null;
  private readonly cubeCamera: THREE.CubeCamera | null;
  private readonly faceCameras: THREE.PerspectiveCamera[];
  private lastCycleT: number | null = null;
  private currentFace = 0;
  private facesRendered = 0;
  private invalidated = true;
  private refreshing = false;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, size: number) {
    this.renderer = renderer;
    this.scene = scene;
    this._size = size;
    this.faceCameras = [];
    // size 0 (low tier) disables capture entirely: no RT, no cameras, texture
    // stays null -> flat ambient unchanged (mirrors aoStrength:0-on-low).
    if (size <= 0) {
      this.renderTarget = null;
      this.cubeCamera = null;
      return;
    }
    const renderTarget = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    const cubeCamera = new THREE.CubeCamera(1, 5000, renderTarget);
    cubeCamera.layers.set(SKY_LAYER);
    cubeCamera.position.set(0, 0, 0);
    scene.add(cubeCamera);
    // Per-face cameras for amortized single-face rendering. Oriented per THREE's
    // WebGL cube face order (PX, NX, PY, NY, PZ, NZ); layer 2 only (belt+suspenders
    // alongside cubeCamera.layers) so terrain/karts never enter the capture.
    for (const dir of FACE_DIRS) {
      const cam = new THREE.PerspectiveCamera(90, 1, 1, 5000);
      cam.position.set(0, 0, 0);
      cam.up.copy(dir.up);
      cam.lookAt(dir.look);
      cam.layers.set(SKY_LAYER);
      cam.updateMatrixWorld(true);
      this.faceCameras.push(cam);
    }
    this.renderTarget = renderTarget;
    this.cubeCamera = cubeCamera;
  }

  /** Captured cube downstream consumers read; null when disabled/disposed. */
  get texture(): THREE.CubeTexture | null {
    return this.renderTarget?.texture ?? null;
  }

  /** Square face pixel size (0 when disabled/disposed). */
  get size(): number {
    return this.disposed ? 0 : this._size;
  }

  /** Advance amortized capture: render one cube face when cadence/invalidation fires. */
  update(cycleT: number): void {
    const rt = this.renderTarget;
    if (!rt || this.disposed) return;
    if (!this.refreshing) {
      if (!this.invalidated && !shouldCaptureSky(this.lastCycleT, cycleT)) return;
      this.refreshing = true;
      this.currentFace = 0;
      this.facesRendered = 0;
    }
    const face = this.currentFace;
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt, face);
    this.renderer.render(this.scene, this.faceCameras[face]!);
    this.renderer.setRenderTarget(prevRT);
    this.facesRendered++;
    this.currentFace = nextCaptureFace(this.currentFace);
    if (this.facesRendered >= SKY_CAPTURE_FACE_COUNT) {
      this.refreshing = false;
      this.invalidated = false;
      this.lastCycleT = cycleT;
      rt.texture.needsUpdate = true;
    }
  }

  /** Force a full re-bake starting next frame (e.g. on weather-preset change). */
  invalidate(): void {
    this.invalidated = true;
  }

  /** Free the WebGLCubeRenderTarget + CubeCamera. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderTarget?.dispose();
    if (this.cubeCamera) this.scene.remove(this.cubeCamera);
  }
}
