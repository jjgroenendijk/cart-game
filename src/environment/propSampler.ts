import * as THREE from "three";
import { hashSeed, makeRNG, type RNG } from "../core/rng";

/**
 * Minimal terrain surface the sampler needs: height, normal, the path
 * corridor distance, and the spawn point. `Terrain` (003) satisfies this
 * structurally; tests pass a stub so no WebGL/physics is required.
 */
export interface SamplerTerrain {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  startPos(out?: THREE.Vector3): THREE.Vector3;
  readonly spline: {
    closestPoint(x: number, z: number): { dist: number };
  };
}

export type PropType = "tree" | "rock" | "bush" | "flower" | "grass";

/** A placement request: how many of `type`, in what scale range. */
export interface PropLayer {
  type: PropType;
  count: number;
  minScale: number;
  maxScale: number;
  /**
   * Max surface tilt (radians from vertical) this layer tolerates. Undefined
   * falls back to SamplerOptions.maxSlope. Big props pass ~35deg (off cliff
   * faces); decorative layers can pass a larger value to allow steep ground.
   */
  maxSlope?: number;
}

export interface PlacedProp {
  x: number;
  y: number;
  z: number;
  /** Surface normal at the base (PropField orients meshes to it). */
  normal: THREE.Vector3;
  type: PropType;
  /** Per-instance seed (propFactory derives geometry variants from it). */
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
  /** Drivable corridor half-width (on-track). */
  trackHalfWidth: number;
  /** Extra clearance beyond the corridor kept clear of props. */
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
 *  - corridor: spline distance >= trackHalfWidth + corridorMargin
 *  - spawn:    outside spawnExclusionRadius of startPos
 *  - bounds:   within worldHalfExtent - edgeMargin
 *  - slope:    surface tilt <= the layer's maxSlope
 * Same seed + same terrain -> identical placement every run.
 */
export function sampleProps(terrain: SamplerTerrain, opts: SamplerOptions): PlacedProp[] {
  const placed: PlacedProp[] = [];
  const slots = buildSlots(opts);
  const spawn = terrain.startPos(new THREE.Vector3());

  for (const layer of opts.layers) {
    const rng = makeRNG((opts.seed ^ hashSeed(layer.type)) >>> 0);
    const maxSlope = layer.maxSlope ?? opts.maxSlope;
    const order = shuffleIndices(slots.length, rng);
    let remaining = layer.count;

    for (let i = 0; i < order.length && remaining > 0; i++) {
      const slot = slots[order[i]]!;
      const hit = trySlot(terrain, opts, layer, maxSlope, slot, rng, spawn);
      if (hit) {
        placed.push(hit);
        remaining--;
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
  /** Drivable corridor half-width (on-track). */
  trackHalfWidth: number;
  /** Extra clearance beyond the corridor kept clear of props. */
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
 * own sub-seed (^ hashSeed(type)) so layers stay independent. Corridor + spawn
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
    const rng = makeRNG((chunkSeed ^ hashSeed(layer.type)) >>> 0);
    const maxSlope = layer.maxSlope ?? opts.maxSlope;
    const order = shuffleIndices(cells.length, rng);
    let remaining = layer.count;
    for (let i = 0; i < order.length && remaining > 0; i++) {
      const c = cells[order[i]]!;
      const hit = tryCell(terrain, opts, layer, maxSlope, c, rng, spawn);
      if (hit) {
        placed.push(hit);
        remaining--;
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
  trackHalfWidth: number;
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
 * Evaluate one candidate at (x,z): corridor clear, spawn clear, slope within
 * maxSlope; on accept return the PlacedProp (consuming scale+seed rng); on
 * reject return null (no scale/seed rng consumed). Caller owns jitter rng +
 * bounds. Pure (no THREE geometry/WebGL); normal comes from terrain.normalAt.
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
  const closest = terrain.spline.closestPoint(x, z);
  if (closest.dist < opts.trackHalfWidth + opts.corridorMargin) return null;
  const dxs = x - spawn.x;
  const dzs = z - spawn.z;
  if (Math.hypot(dxs, dzs) < opts.spawnExclusionRadius) return null;
  const normal = terrain.normalAt(x, z, new THREE.Vector3());
  const tilt = Math.acos(clamp11(normal.y));
  if (tilt > maxSlope) return null;
  const y = terrain.heightAt(x, z);
  const scale = rng.range(layer.minScale, layer.maxScale);
  const seed = (rng.next() * 0x100000000) >>> 0;
  return { x, y, z, normal, type: layer.type, seed, scale };
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
