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
    const rng = makeRNG((opts.seed ^ hashSeed(layer.kind)) >>> 0);
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

interface Slot {
  cx: number;
  cz: number;
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

    const closest = terrain.spline.closestPoint(x, z);
    if (closest.dist < opts.trackHalfWidth + opts.corridorMargin) continue;

    const dxs = x - spawn.x;
    const dzs = z - spawn.z;
    if (Math.hypot(dxs, dzs) < opts.spawnExclusionRadius) continue;

    const normal = terrain.normalAt(x, z, new THREE.Vector3());
    const tilt = Math.acos(clamp11(normal.y));
    if (tilt > maxSlope) continue;

    const y = terrain.heightAt(x, z);
    const scale = rng.range(layer.minScale, layer.maxScale);
    const seed = (rng.next() * 0x100000000) >>> 0;
    return { x, y, z, normal, kind: layer.kind, seed, scale };
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
