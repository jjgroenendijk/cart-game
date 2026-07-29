import * as THREE from "three";
import { hashSeed, makeRNG } from "../core/rng";

const UP = new THREE.Vector3(0, 1, 0);

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
