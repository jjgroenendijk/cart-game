import * as THREE from "three";
import { makeCel, type CelMaterial } from "../materials/cel";
import { clusterLayout } from "./cloudCluster";
import { dayCycleState } from "./dayCycle";
import { CLOUD_BASE_TINT, cloudTintFor } from "./cloudTint";

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
  /** Multiplier on the default cloud count (1.0). Ignored when count is set. */
  density?: number;
  /** Base altitude for cluster centers; alias for cloudHeight (wins if both). */
  altitude?: number;
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
 * cloud is K jittered puffs around a center -> painted-blob silhouette. Each
 * frame update() recycles every puff's XZ around the moving focus
 * ({@link recycleAxis}, same form as the snow vertex-shader wrap) so the
 * field stays world-stationary (clouds gain correct driving parallax)
 * instead of rigidly translating with the kart; the wind drifts puffs +X.
 * No outline on instanced draws (the 001 inverted-hull shader has no
 * instance-matrix path; soft cel blobs are the accepted fallback). No
 * shadows.
 */
/**
 * Recycle an axis value around a moving focus so the point holds a fixed
 * world position and only wraps when it drifts past `focus +/- half`.
 * `motion` is the point's own world-space drift on that axis (e.g. wind).
 * `world = focus + mod(base + motion - focus + half, 2*half) - half`. With
 * `focus` 0 this reduces to the origin-anchored wrap. Pure: mirrors the
 * snow vertex-shader XZ wrap (see Weather.advancePosition) so the cloud
 * field stays world-stationary under focus translation, not rigidly glued.
 */
export function recycleAxis(base: number, motion: number, focus: number, half: number): number {
  const span = 2 * half;
  const m = (((base + motion - focus + half) % span) + span) % span;
  return focus + m - half;
}

export class Clouds {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: CelMaterial;
  private readonly wrap: number;
  private readonly drift: number;
  private readonly baseTint: THREE.Color;
  private readonly tintOut = new THREE.Color();
  private readonly baseMatrices: THREE.Matrix4[];
  private readonly baseX: Float32Array;
  private readonly baseZ: Float32Array;
  private readonly scratchMatrix = new THREE.Matrix4();
  private driftX = 0;

  constructor(opts: CloudsOptions = {}) {
    const count = opts.count ?? Math.round(DEFAULT_COUNT * (opts.density ?? 1));
    const puffsPerCloud = opts.puffsPerCloud ?? DEFAULT_PUFFS_PER_CLOUD;
    const height = opts.altitude ?? opts.cloudHeight ?? DEFAULT_HEIGHT;
    const half = opts.worldHalfExtent ?? DEFAULT_HALF;
    this.wrap = half + 20;
    this.drift = opts.driftSpeed ?? DRIFT_SPEED;
    this.baseTint = new THREE.Color(opts.color ?? CLOUD_BASE_TINT);

    const geo = new THREE.IcosahedronGeometry(PUFF_RADIUS, 0);
    geo.scale(1, SQUASH, 1);
    this.material = makeCel({
      flatShading: true,
      color: opts.color ?? CLOUD_BASE_TINT,
    });

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

    const n = matrices.length;
    this.baseMatrices = matrices;
    this.baseX = new Float32Array(n);
    this.baseZ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const el = matrices[i].elements;
      this.baseX[i] = el[12];
      this.baseZ[i] = el[14];
      this.mesh.setMatrixAt(i, matrices[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
  }

  /** Advance the drift + re-derive the day-cycle cloud tint from the singleton. */
  update(dt: number, focusX = 0, focusZ = 0): void {
    const span = 2 * this.wrap;
    this.driftX = (((this.driftX + this.drift * dt) % span) + span) % span;
    const baseMatrices = this.baseMatrices;
    const baseX = this.baseX;
    const baseZ = this.baseZ;
    const scratch = this.scratchMatrix;
    for (let i = 0; i < baseMatrices.length; i++) {
      scratch.copy(baseMatrices[i]);
      scratch.elements[12] = recycleAxis(baseX[i], this.driftX, focusX, this.wrap);
      scratch.elements[14] = recycleAxis(baseZ[i], 0, focusZ, this.wrap);
      this.mesh.setMatrixAt(i, scratch);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    cloudTintFor(dayCycleState.phase, dayCycleState.skyHorizon, this.baseTint, this.tintOut);
    this.material.uniforms.uColor.value.copy(this.tintOut);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
