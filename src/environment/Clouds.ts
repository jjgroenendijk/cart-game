import * as THREE from "three";
import { makeCel, type CelMaterial } from "../materials/cel";
import { clusterLayout } from "./cloudCluster";

const CLOUD_LAYER = 0;
const PUFF_RADIUS = 6;
const SQUASH = 0.4;
const DRIFT_SPEED = 2; // m/s
const DEFAULT_COUNT = 24;
const DEFAULT_HEIGHT = 60;
const DEFAULT_HALF = 100;
const DEFAULT_PUFFS_PER_CLOUD = 6;

export interface CloudsOptions {
  count?: number;
  /** Puffs per cloud cluster. Default 6. */
  puffsPerCloud?: number;
  cloudHeight?: number;
  worldHalfExtent?: number;
  driftSpeed?: number;
  seed?: number;
  /** sRGB hex cloud tint. */
  color?: number;
}

/**
 * Drifting low-poly cloud layer for 004/014. One InstancedMesh of
 * count*puffsPerCloud squashed-icosahedron puffs (CelMaterial flatShading) on
 * layer 0. Puffs are placed once (deterministic seed) via clusterLayout: each
 * cloud is K jittered puffs around a center -> painted-blob silhouette. The
 * whole group drifts +X and wraps (infinite scroll). No outline on instanced
 * draws (the 001 inverted-hull shader has no instance-matrix path; soft cel
 * blobs are the accepted fallback). No shadows.
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: CelMaterial;
  private readonly wrap: number;
  private readonly drift: number;

  constructor(opts: CloudsOptions = {}) {
    const count = opts.count ?? DEFAULT_COUNT;
    const puffsPerCloud = opts.puffsPerCloud ?? DEFAULT_PUFFS_PER_CLOUD;
    const height = opts.cloudHeight ?? DEFAULT_HEIGHT;
    const half = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.wrap = half + 20;
    this.drift = opts.driftSpeed ?? DRIFT_SPEED;

    const geo = new THREE.IcosahedronGeometry(PUFF_RADIUS, 0);
    geo.scale(1, SQUASH, 1);
    this.material = makeCel({ flatShading: true, color: opts.color ?? 0xf2f4f8 });

    const matrices = clusterLayout({
      clouds: count,
      puffsPerCloud,
      worldHalfExtent: half,
      cloudHeight: height,
      seed: opts.seed ?? 1337,
      puffRadius: PUFF_RADIUS,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, matrices.length);
    this.mesh.layers.set(CLOUD_LAYER);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    for (let i = 0; i < matrices.length; i++) {
      this.mesh.setMatrixAt(i, matrices[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
  }

  /** Advance the drift; the group wraps to keep puffs in bounds. */
  update(dt: number): void {
    this.group.position.x += this.drift * dt;
    if (this.group.position.x > this.wrap) this.group.position.x -= 2 * this.wrap;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
