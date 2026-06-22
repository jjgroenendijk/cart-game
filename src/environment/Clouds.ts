import * as THREE from "three";
import { makeCel, type CelMaterial } from "../materials/cel";
import { makeRNG } from "../core/rng";

const CLOUD_LAYER = 0;
const PUFF_RADIUS = 6;
const SQUASH = 0.4;
const DRIFT_SPEED = 2; // m/s
const DEFAULT_COUNT = 24;
const DEFAULT_HEIGHT = 60;
const DEFAULT_HALF = 100;

export interface CloudsOptions {
  count?: number;
  cloudHeight?: number;
  worldHalfExtent?: number;
  driftSpeed?: number;
  seed?: number;
  /** sRGB hex cloud tint. */
  color?: number;
}

/**
 * Drifting low-poly cloud layer for 004. One InstancedMesh of squashed
 * icosahedron puffs (CelMaterial flatShading) on layer 0. Puffs are placed once
 * (deterministic seed) across the world at a fixed altitude; the whole group
 * drifts in +X and wraps (infinite scroll). No outline on instanced draws (the
 * 001 inverted-hull shader has no instance-matrix path; soft cel blobs are the
 * accepted fallback — see docs/troubleshooting/2026-06-22_004-environment).
 * No shadows.
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: CelMaterial;
  private readonly wrap: number;
  private readonly drift: number;

  constructor(opts: CloudsOptions = {}) {
    const count = opts.count ?? DEFAULT_COUNT;
    const height = opts.cloudHeight ?? DEFAULT_HEIGHT;
    const half = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.wrap = half + 20;
    this.drift = opts.driftSpeed ?? DRIFT_SPEED;

    const geo = new THREE.IcosahedronGeometry(PUFF_RADIUS, 0);
    geo.scale(1, SQUASH, 1);
    this.material = makeCel({ flatShading: true, color: opts.color ?? 0xf2f4f8 });
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.layers.set(CLOUD_LAYER);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    const rng = makeRNG(opts.seed ?? 1337);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(rng.range(-half, half), height + rng.range(-3, 3), rng.range(-half, half));
      const s = rng.range(0.8, 1.6);
      dummy.scale.set(s, s, s);
      dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
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
