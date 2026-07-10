import * as THREE from "three";
import { hashSeed, makeRNG, type RNG } from "../core/rng";
import type { HeightMapField } from "../materials/cel";

/**
 * Minimal terrain surface the sampler needs: height, normal, the corridor
 * clearance, and the spawn point. `Terrain` (003) satisfies this
 * structurally; tests pass a stub so no WebGL/physics is required.
 */
export interface SamplerTerrain {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  startPos(out?: THREE.Vector3): THREE.Vector3;
  /**
   * Signed lateral clearance from the corridor edge (m): dist - halfWidth at
   * the LOCAL road width (059). <= 0 = on the road. Replaces the old
   * closestPoint dist + constant trackHalfWidth pair so wide roads stay
   * clear of flora.
   */
  corridorClearance(x: number, z: number): number;
  /**
   * Optional baked bed-height field (062 depth-aware water). The real Terrain
   * exposes this; stubs/tests omit it -> water falls back to the facing look.
   */
  heightMapField?: () => HeightMapField | undefined;
  /** Optional water surface Y (062); undefined = caller's default level. */
  readonly waterLevel?: number;
}

/** Flora kind name; resolved via the flora registry (string-keyed, no union). */
export type FloraKind = string;

/** A placement request: how many of `kind`, in what scale range. */
export interface PropLayer {
  kind: FloraKind;
  count: number;
  minScale: number;
  maxScale: number;
  /**
   * Max surface tilt (radians from vertical) this layer tolerates. Undefined
   * falls back to SamplerOptions.maxSlope. Big props pass ~35deg (off cliff
   * faces); decorative layers can pass a larger value to allow steep ground.
   */
  maxSlope?: number;
  /**
   * Optional cluster recipe (mirrors FloraBuilder.cluster): place in groves of
   * `perCluster` within `radius` of each accepted anchor instead of uniformly.
   * Undefined = uniform jittered-grid scatter (legacy behaviour).
   */
  cluster?: { radius: number; perCluster: number };
}

export interface PlacedProp {
  x: number;
  y: number;
  z: number;
  /** Surface normal at the base (PropField orients meshes to it). */
  normal: THREE.Vector3;
  kind: FloraKind;
  /** Per-instance seed (flora builders derive geometry variants from it). */
  seed: number;
  scale: number;
}

export interface SamplerOptions {
  seed: number;
  /** World spans [-worldHalfExtent, +worldHalfExtent] on X and Z. */
  worldHalfExtent: number;
  /** Inset from the world edge inside which nothing is placed. */
  edgeMargin: number;
  /** Jittered-grid cell size (metres). Smaller -> denser candidates. */
  cell: number;
  /** Max jittered candidates tried per grid slot before giving up on it. */
  maxAttemptsPerSlot: number;
  /** Extra clearance beyond the corridor edge kept clear of props. */
  corridorMargin: number;
  /** Radius around the spawn point kept clear of props. */
  spawnExclusionRadius: number;
  /** Default max surface tilt (radians from vertical) for big props. */
  maxSlope: number;
  layers: PropLayer[];
}

/**
 * Deterministic jittered-grid sampler. For each layer it shuffles the world
 * grid slots with a per-layer sub-RNG (so layer order/counts do not bleed
 * into each other), then tries up to `maxAttemptsPerSlot` jittered candidates
 * per slot, accepting the first that clears:
 *  - corridor: corridorClearance >= corridorMargin (local road width, 059)
 *  - spawn:    outside spawnExclusionRadius of startPos
 *  - bounds:   within worldHalfExtent - edgeMargin
 *  - slope:    surface tilt <= the layer's maxSlope
 *  - water:    terrain base is at or above waterLevel, when supplied
 * Same seed + same terrain -> identical placement every run.
 */
export function sampleProps(terrain: SamplerTerrain, opts: SamplerOptions): PlacedProp[] {
  const placed: PlacedProp[] = [];
  const slots = buildSlots(opts);
  const spawn = terrain.startPos(new THREE.Vector3());

  for (const layer of opts.layers) {
    const rng = makeRNG((opts.seed ^ hashSeed(layer.kind)) >>> 0);
    const maxSlope = layer.maxSlope ?? opts.maxSlope;
    const order = shuffleIndices(slots.length, rng);
    let remaining = layer.count;

    for (let i = 0; i < order.length && remaining > 0; i++) {
      const slot = slots[order[i]]!;
      const hit = trySlot(terrain, opts, layer, maxSlope, slot, rng, spawn);
      if (!hit) continue;
      placed.push(hit);
      remaining--;
      if (layer.cluster && remaining > 0) {
        remaining -= scatterCluster(
          hit,
          layer.cluster,
          opts.maxAttemptsPerSlot,
          terrain,
          opts,
          layer,
          maxSlope,
          rng,
          spawn,
          (x, z) => !outOfBounds(x, z, opts),
          placed,
          remaining,
        );
      }
    }
  }

  return placed;
}

export interface ChunkSampleOptions {
  /** Jittered-grid cell size (metres) within the chunk rect. */
  cell: number;
  /** Max jittered candidates tried per cell before giving up on it. */
  maxAttemptsPerCell: number;
  /** Extra clearance beyond the corridor edge kept clear of props. */
  corridorMargin: number;
  /** Radius around the spawn point kept clear of props. */
  spawnExclusionRadius: number;
  /** Default max surface tilt (radians from vertical) for big props. */
  maxSlope: number;
}

/**
 * 023 per-chunk deterministic prop sampler. Jittered grid over `rect` ONLY;
 * per-chunk seed = hashSeed(gx+","+gz) ^ baseSeed, so re-activating the same
 * chunk reproduces identical placement (coordinate-stable). Each layer gets its
 * own sub-seed (^ hashSeed(kind)) so layers stay independent. Corridor + spawn
 * rejection still applies (keeps the track + spawn clear) but is a no-op far
 * from the track (spline dist large -> passes). Slope + height come from
 * terrain. `layer.count` is the target placements FOR THIS CHUNK. Pure (no
 * THREE geometry/WebGL/physics); jsdom-testable.
 */
export function sampleChunkProps(
  gx: number,
  gz: number,
  rect: { x0: number; z0: number; x1: number; z1: number },
  terrain: SamplerTerrain,
  baseSeed: number,
  layers: PropLayer[],
  opts: ChunkSampleOptions,
): PlacedProp[] {
  const placed: PlacedProp[] = [];
  const spawn = terrain.startPos(new THREE.Vector3());
  const chunkSeed = (baseSeed ^ hashSeed(gx + "," + gz)) >>> 0;
  const cells = buildRectCells(rect, opts.cell);
  for (const layer of layers) {
    const rng = makeRNG((chunkSeed ^ hashSeed(layer.kind)) >>> 0);
    const maxSlope = layer.maxSlope ?? opts.maxSlope;
    const order = shuffleIndices(cells.length, rng);
    let remaining = layer.count;
    for (let i = 0; i < order.length && remaining > 0; i++) {
      const c = cells[order[i]]!;
      const hit = tryCell(terrain, opts, layer, maxSlope, c, rng, spawn);
      if (!hit) continue;
      placed.push(hit);
      remaining--;
      if (layer.cluster && remaining > 0) {
        remaining -= scatterCluster(
          hit,
          layer.cluster,
          opts.maxAttemptsPerCell,
          terrain,
          opts,
          layer,
          maxSlope,
          rng,
          spawn,
          (x, z) => x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1,
          placed,
          remaining,
        );
      }
    }
  }
  return placed;
}

interface Slot {
  cx: number;
  cz: number;
}

/** Rejection + sampling params shared by the world + per-chunk samplers. */
interface RejectOpts {
  corridorMargin: number;
  spawnExclusionRadius: number;
}

function buildSlots(opts: SamplerOptions): Slot[] {
  const lo = -opts.worldHalfExtent + opts.edgeMargin;
  const hi = opts.worldHalfExtent - opts.edgeMargin;
  const cell = opts.cell;
  const slots: Slot[] = [];
  for (let z = lo; z <= hi; z += cell) {
    for (let x = lo; x <= hi; x += cell) {
      slots.push({ cx: x, cz: z });
    }
  }
  return slots;
}

function buildRectCells(
  rect: { x0: number; z0: number; x1: number; z1: number },
  cell: number,
): Slot[] {
  const slots: Slot[] = [];
  for (let z = rect.z0; z < rect.z1; z += cell) {
    for (let x = rect.x0; x < rect.x1; x += cell) {
      slots.push({ cx: x, cz: z });
    }
  }
  return slots;
}

/**
 * Evaluate one candidate at (x,z): corridor/spawn clear, above water when
 * supplied, and slope within maxSlope; on accept return the PlacedProp
 * (consuming scale+seed rng); on reject return null (no scale/seed rng
 * consumed). Caller owns jitter rng + bounds. Pure (no THREE geometry/WebGL);
 * normal comes from terrain.normalAt.
 */
function tryCandidateAt(
  x: number,
  z: number,
  terrain: SamplerTerrain,
  layer: PropLayer,
  maxSlope: number,
  rng: RNG,
  spawn: THREE.Vector3,
  opts: RejectOpts,
): PlacedProp | null {
  if (terrain.corridorClearance(x, z) < opts.corridorMargin) return null;
  const dxs = x - spawn.x;
  const dzs = z - spawn.z;
  if (Math.hypot(dxs, dzs) < opts.spawnExclusionRadius) return null;
  const y = terrain.heightAt(x, z);
  if (terrain.waterLevel !== undefined && y < terrain.waterLevel) return null;
  const normal = terrain.normalAt(x, z, new THREE.Vector3());
  const tilt = Math.acos(clamp11(normal.y));
  if (tilt > maxSlope) return null;
  const scale = rng.range(layer.minScale, layer.maxScale);
  const seed = (rng.next() * 0x100000000) >>> 0;
  return { x, y, z, normal, kind: layer.kind, seed, scale };
}

function trySlot(
  terrain: SamplerTerrain,
  opts: SamplerOptions,
  layer: PropLayer,
  maxSlope: number,
  slot: Slot,
  rng: RNG,
  spawn: THREE.Vector3,
): PlacedProp | null {
  const half = opts.cell / 2;
  for (let a = 0; a < opts.maxAttemptsPerSlot; a++) {
    const x = slot.cx + rng.unit() * half;
    const z = slot.cz + rng.unit() * half;
    if (outOfBounds(x, z, opts)) continue;
    const hit = tryCandidateAt(x, z, terrain, layer, maxSlope, rng, spawn, opts);
    if (hit) return hit;
  }
  return null;
}

function tryCell(
  terrain: SamplerTerrain,
  opts: ChunkSampleOptions,
  layer: PropLayer,
  maxSlope: number,
  slot: Slot,
  rng: RNG,
  spawn: THREE.Vector3,
): PlacedProp | null {
  const half = opts.cell / 2;
  for (let a = 0; a < opts.maxAttemptsPerCell; a++) {
    const x = slot.cx + rng.unit() * half;
    const z = slot.cz + rng.unit() * half;
    const hit = tryCandidateAt(x, z, terrain, layer, maxSlope, rng, spawn, opts);
    if (hit) return hit;
  }
  return null;
}

/**
 * Scatter up to `perCluster - 1` neighbours within `radius` of an accepted
 * anchor so a clustered layer (palms forming groves) reads as a tight group.
 * Each neighbour is independently rejected (corridor/spawn/slope/bounds) via
 * tryCandidateAt; returns how many were placed. Deterministic (rng sequence is
 * fixed for a given anchor + budget).
 */
function scatterCluster(
  anchor: PlacedProp,
  cluster: { radius: number; perCluster: number },
  maxAttempts: number,
  terrain: SamplerTerrain,
  opts: RejectOpts,
  layer: PropLayer,
  maxSlope: number,
  rng: RNG,
  spawn: THREE.Vector3,
  boundsOk: (x: number, z: number) => boolean,
  placed: PlacedProp[],
  budget: number,
): number {
  const want = Math.min(cluster.perCluster - 1, budget);
  if (want <= 0) return 0;
  let count = 0;
  const maxTries = want * maxAttempts;
  for (let t = 0; t < maxTries && count < want; t++) {
    const a = rng.unit() * Math.PI * 2;
    const r = rng.range(cluster.radius * 0.3, cluster.radius);
    const nx = anchor.x + Math.cos(a) * r;
    const nz = anchor.z + Math.sin(a) * r;
    if (!boundsOk(nx, nz)) continue;
    const hit = tryCandidateAt(nx, nz, terrain, layer, maxSlope, rng, spawn, opts);
    if (hit) {
      placed.push(hit);
      count++;
    }
  }
  return count;
}

function outOfBounds(x: number, z: number, opts: SamplerOptions): boolean {
  const limit = opts.worldHalfExtent - opts.edgeMargin;
  return Math.abs(x) > limit || Math.abs(z) > limit;
}

function clamp11(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Fisher-Yates over 0..n-1 using the given RNG (deterministic). */
function shuffleIndices(n: number, rng: RNG): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}
