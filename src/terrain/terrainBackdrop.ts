/**
 * 203 HLOD backdrop mesh. One static coarse ring of terrain BEYOND the streamed
 * chunk ring, so the horizon reads as real distant terrain instead of an empty
 * fog wall. Owns a single layer-1 mesh built by {@link buildBackdropRing} from
 * the shared HeightSource (ridgelines align with the streamed terrain) and the
 * far cel material (vertex colours + USE_FOG) so it hazes into the fogged
 * horizon and shares the terrain hue. Recentres on the camera focus at coarse
 * (snapToStep) granularity — a rebuild only when the focus crosses a cell, never
 * per-frame. No collider, no Rapier body: a pure visual far mesh.
 */

import * as THREE from "three";
import type { HeightSource } from "./heightSource";
import type { Pt } from "../kart/kartLod";
import { buildFarCel } from "./terrainCelMaterials";
import { buildBackdropRing, snapToStep, type BackdropRingParams } from "./backdropGeometry";

const TERRAIN_LAYER = 1;

export interface TerrainBackdropOptions {
  /** Inner radius (metres): meets the streamed cull ring. */
  innerRadius: number;
  /** Outer radius (metres): past the fog horizon so it hazes fully out. */
  outerRadius: number;
  /** Radial subdivisions (rings = radialSegments + 1). Default 16. */
  radialSegments?: number;
  /** Angular columns around the ring (wraps). Default 96. */
  angularSegments?: number;
  /** Outer skirt vertical drop (metres). Default 60; <= 0 emits no skirt. */
  skirtDrop?: number;
  /** Recentre snap granularity (metres): the ring rebuilds only when the focus
   * crosses this. Coarse so rebuilds are rare (the far mesh is hazed). Default 48. */
  recenterStep?: number;
}

export class TerrainBackdrop {
  readonly group = new THREE.Group();

  private readonly src: HeightSource;
  private readonly material: THREE.Material;
  private readonly params: Omit<BackdropRingParams, "centerX" | "centerZ">;
  private readonly recenterStep: number;
  private mesh: THREE.Mesh | null = null;
  private centerX = NaN;
  private centerZ = NaN;
  private disposed = false;

  constructor(src: HeightSource, opts: TerrainBackdropOptions) {
    this.src = src;
    this.material = buildFarCel();
    this.params = {
      innerRadius: opts.innerRadius,
      outerRadius: opts.outerRadius,
      radialSegments: opts.radialSegments ?? 16,
      angularSegments: opts.angularSegments ?? 96,
      skirtDrop: opts.skirtDrop ?? 60,
    };
    this.recenterStep = opts.recenterStep ?? 48;
    // The group is parented once and never transformed -> freeze its matrix.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  /**
   * Recentre the ring on the mean camera focus (XZ), snapped to the coarse grid.
   * A no-op unless the snapped centre moved — so the coarse mesh rebuilds only
   * when the focus crosses a cell, not per-frame. Geometry is authored at
   * absolute world coords (never a translated mesh), so ridgelines stay aligned
   * with the streamed terrain and the mesh bounds are correct after each build.
   */
  update(cameras: readonly Pt[]): void {
    if (this.disposed || cameras.length === 0) return;
    let sx = 0;
    let sz = 0;
    for (const c of cameras) {
      sx += c.x;
      sz += c.z;
    }
    const cx = snapToStep(sx / cameras.length, this.recenterStep);
    const cz = snapToStep(sz / cameras.length, this.recenterStep);
    if (cx === this.centerX && cz === this.centerZ) return;
    this.rebuild(cx, cz);
  }

  private rebuild(centerX: number, centerZ: number): void {
    const g = buildBackdropRing({ ...this.params, centerX, centerZ }, this.src);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.receiveShadow = true;
      mesh.layers.set(TERRAIN_LAYER);
      // Recentred field that surrounds every camera: skip the frustum cull (the
      // ring wraps the camera, so the cull test can never usefully win) — see the
      // #175 recentred-field gotcha. Matrix frozen (geometry is world-space).
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.mesh = mesh;
      this.group.add(mesh);
    }
    this.centerX = centerX;
    this.centerZ = centerZ;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.material.dispose();
    this.group.clear();
  }
}
