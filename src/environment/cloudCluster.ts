import * as THREE from "three";
import { hashSeed, makeRNG } from "../core/rng";

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

export interface ClusterLayoutOptions {
  /** Cluster centers (clouds). */
  clouds: number;
  /** Puffs per cluster. */
  puffsPerCloud: number;
  /** World XZ bounds; centers inset so puffs stay in [-h, +h]. */
  worldHalfExtent: number;
  /** Base altitude for cluster centers. */
  cloudHeight: number;
  /** Deterministic seed. */
  seed: number;
  /** Single puff mesh radius. Default 6. */
  puffRadius?: number;
  /** Max XZ puff offset from center. Default puffRadius * 1.5. */
  clusterRadius?: number;
  /** Vertical spread +/- around cloudHeight. Default 4. */
  heightJitter?: number;
  /** Per-puff uniform scale [min, max]. Default [0.8, 1.6] (004 range). */
  scaleRange?: [number, number];
}

/**
 * Pure layout for multi-puff cloud clusters (014). Places `clouds` centers in
 * the world box, then scatters `puffsPerCloud` jittered puffs around each ->
 * painted-blob silhouette. One flat Matrix4[] (length clouds*puffsPerCloud)
 * feeds a single InstancedMesh (011 draw budget). Deterministic: master RNG
 * (seed ^ hashSeed "clouds") walks centers; per-cloud sub-RNG
 * (hashSeed "cloud"+i) owns puff jitter so one cloud's puffs stay stable
 * regardless of total cloud count. Center range inset by clusterRadius ->
 * every puff position stays in [-worldHalfExtent, +worldHalfExtent]. jsdom-safe
 * (Matrix4 / Vector3 math only).
 */
export function clusterLayout(opts: ClusterLayoutOptions): THREE.Matrix4[] {
  const {
    clouds,
    puffsPerCloud,
    worldHalfExtent,
    cloudHeight,
    seed,
    puffRadius = 6,
    clusterRadius = puffRadius * 1.5,
    heightJitter = 4,
    scaleRange = [0.8, 1.6],
  } = opts;

  const out: THREE.Matrix4[] = [];
  const centerLo = -(worldHalfExtent - clusterRadius);
  const centerHi = worldHalfExtent - clusterRadius;

  const masterSeed = (seed ^ hashSeed("clouds")) >>> 0;
  const centerRng = makeRNG(masterSeed);

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  for (let c = 0; c < clouds; c++) {
    const cx = centerRng.range(centerLo, centerHi);
    const cz = centerRng.range(centerLo, centerHi);
    const cy = cloudHeight + centerRng.range(-heightJitter, heightJitter);

    const puffRng = makeRNG((masterSeed ^ hashSeed(`cloud${c}`)) >>> 0);
    for (let p = 0; p < puffsPerCloud; p++) {
      pos.set(
        cx + puffRng.unit() * clusterRadius,
        cy + puffRng.range(-heightJitter, heightJitter),
        cz + puffRng.unit() * clusterRadius,
      );
      quat.setFromAxisAngle(UP, puffRng.range(0, Math.PI * 2));
      const s = puffRng.range(scaleRange[0], scaleRange[1]);
      scl.set(s, s, s);
      out.push(new THREE.Matrix4().compose(pos, quat, scl));
    }
  }
  return out;
}

export interface FarBandLayoutOptions {
  /** Cluster count spaced evenly around the horizon ring. */
  clusters: number;
  /** Puffs per cluster. */
  puffsPerCluster: number;
  /** Ring radius (world units) from the ring centre / camera. */
  radius: number;
  /** Band altitude (world Y). */
  altitude: number;
  /** Deterministic seed. */
  seed: number;
  /** +/- radial jitter on the ring radius. Default radius * 0.06. */
  radialJitter?: number;
  /** +/- vertical spread around altitude. Default 8. */
  heightJitter?: number;
  /** Per-puff uniform scale [min, max] (large soft blobs). Default [8, 13]. */
  scaleRange?: [number, number];
  /** +/- angular jitter as a fraction of one slot. Default 0.4. */
  angularJitter?: number;
  /** Tangential/radial puff spread within a cluster (world units). Default radius*0.05. */
  spread?: number;
}

/**
 * Pure layout for the parallax-free far cloud band. Places `clusters` centres
 * evenly around a horizon RING of `radius` (each jittered in angle + radius),
 * then scatters `puffsPerCluster` large jittered puffs around each -> a
 * continuous painted horizon band. One flat Matrix4[] (length
 * clusters*puffsPerCluster) feeds a single InstancedMesh the camera drags
 * along by XZ each frame, so the band never gains parallax and never
 * recycles/pops (unlike the world-anchored near puffs). Deterministic: master
 * RNG (seed ^ hashSeed "cloudBand") walks centres; per-cluster sub-RNG
 * (hashSeed "band"+i) owns puff jitter so a cluster stays stable regardless of
 * total count. jsdom-safe (Matrix4 / Vector3 math only).
 */
export function farBandLayout(opts: FarBandLayoutOptions): THREE.Matrix4[] {
  const {
    clusters,
    puffsPerCluster,
    radius,
    altitude,
    seed,
    radialJitter = radius * 0.06,
    heightJitter = 8,
    scaleRange = [8, 13],
    angularJitter = 0.4,
    spread = radius * 0.05,
  } = opts;

  const out: THREE.Matrix4[] = [];
  const masterSeed = (seed ^ hashSeed("cloudBand")) >>> 0;
  const centerRng = makeRNG(masterSeed);
  const slot = clusters > 0 ? TAU / clusters : 0;

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  for (let c = 0; c < clusters; c++) {
    const angle = c * slot + centerRng.unit() * angularJitter * slot;
    const r = radius + centerRng.unit() * radialJitter;
    const cx = Math.cos(angle) * r;
    const cz = Math.sin(angle) * r;
    const cy = altitude + centerRng.unit() * heightJitter;

    const puffRng = makeRNG((masterSeed ^ hashSeed(`band${c}`)) >>> 0);
    for (let p = 0; p < puffsPerCluster; p++) {
      pos.set(
        cx + puffRng.unit() * spread,
        cy + puffRng.unit() * heightJitter,
        cz + puffRng.unit() * spread,
      );
      quat.setFromAxisAngle(UP, puffRng.range(0, TAU));
      const s = puffRng.range(scaleRange[0], scaleRange[1]);
      scl.set(s, s, s);
      out.push(new THREE.Matrix4().compose(pos, quat, scl));
    }
  }
  return out;
}
