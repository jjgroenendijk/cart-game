import * as THREE from "three";
import { makeCel, type CelMaterial } from "../materials/cel";
import type { SamplerTerrain } from "./propSampler";
import {
  critterPose,
  defaultCritterOptions,
  placeCritters,
  type CritterOptions,
  type CritterPose,
  type PlacedCritter,
} from "./critters";

const WILDLIFE_LAYER = 0;
const UP_Y = new THREE.Vector3(0, 1, 0);

export interface WildlifeOptions {
  seed?: number;
  /** sRGB hex bird tint. */
  color?: number;
  /** Full CritterOptions overrides (worldHalfExtent, cell, count, etc.). */
  critter?: Partial<CritterOptions>;
}

/**
 * 017 ambient wildlife — the InstancedMesh child of the pure critter helpers.
 *
 * One flat-shaded CelMaterial InstancedMesh of low-poly bird silhouettes on
 * layer 0, placed once via the deterministic placeCritters sampler, then
 * re-posed every frame. No outline: the 001 inverted-hull shader has no
 * instance-matrix path, so instanced decor renders cel-only (Clouds/decor
 * parity). No shadows — ambient decor stays cost-free. update recomputes
 * every instance matrix as a pure fn of absolute time, so the same placed
 * field + the same time yields identical matrices every frame (deterministic
 * replay). dispose frees the GL resources and is idempotent.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: CelMaterial;
  private readonly placed: PlacedCritter[];
  private disposed = false;

  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();
  private readonly scratchMat = new THREE.Matrix4();
  private readonly scratchPose: CritterPose = {
    pos: new THREE.Vector3(),
    yaw: 0,
    scale: 1,
  };

  constructor(terrain: SamplerTerrain, opts: WildlifeOptions = {}) {
    const copts: CritterOptions = {
      ...defaultCritterOptions(opts.seed ?? 1337),
      ...opts.critter,
    };
    this.placed = placeCritters(terrain, copts);

    this.material = makeCel({
      flatShading: true,
      color: opts.color ?? 0x202020,
    });

    const geo = this.birdGeometry();
    this.mesh = new THREE.InstancedMesh(geo, this.material, this.placed.length);
    this.mesh.layers.set(WILDLIFE_LAYER);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    for (let i = 0; i < this.placed.length; i++) {
      this.writeMatrix(i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
  }

  /**
   * Recompute every instance matrix as a pure fn of `time` (seconds). Motion
   * is a pure fn of absolute time, so `dt` is unused by design.
   */
  update(_dt: number, time: number): void {
    for (let i = 0; i < this.placed.length; i++) {
      this.writeMatrix(i, time);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }

  /**
   * Compose instance `i`'s matrix from its orbit pose at time `t`: position
   * from pose.pos, yaw about +Y, uniform scale. Reuses scratch objects to
   * avoid per-frame allocations.
   */
  private writeMatrix(i: number, t: number): void {
    const pose = critterPose(this.placed[i]!, t, this.scratchPose);
    this.scratchQuat.setFromAxisAngle(UP_Y, pose.yaw);
    this.scratchScale.setScalar(pose.scale);
    this.scratchMat.compose(pose.pos, this.scratchQuat, this.scratchScale);
    this.mesh.setMatrixAt(i, this.scratchMat);
  }

  /**
   * Flat bird silhouette: two triangles, all vertices at y=0 so flatShading
   * yields a clean wings-from-above read (~2m wingspan, scaled per instance).
   * Forward axis is +Z (nose at z=+0.25, tail at z=-0.4); yaw about +Y rotates
   * the heading. Winding is counter-clockwise from above so normals face +Y.
   */
  private birdGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([-1.0, 0, 0.0, 0.0, 0, 0.25, 1.0, 0, 0.0, 0.0, 0, -0.4]);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2, 2, 3, 1]);
    geo.computeVertexNormals();
    return geo;
  }
}
