import * as THREE from "three";
import { hashSeed, makeRNG, type RNG } from "../core/rng";
import { degToRad } from "../core/math";
import type { SamplerTerrain } from "./propSampler";

/**
 * 017 ambient wildlife — pure placement + orbit-pose helpers.
 *
 * Placement mirrors propSampler: a deterministic jittered grid whose
 * candidates are rejected on the drivable corridor, the spawn exclusion
 * radius, world bounds, and a max-surface-tilt gate. Unlike propSampler
 * there is a single critter layer (no per-type sub-layers) and no Rapier
 * body ownership — Wildlife.ts (a later commit) owns the InstancedMesh.
 * Each placed critter orbits its anchor on an inclined plane with a
 * sinusoidal altitude bob; critterPose is a pure, deterministic fn of time.
 *
 * Sub-seed: the sole RNG is `makeRNG((seed ^ hashSeed("critter")) >>> 0)` so
 * the same seed reproduces the same critter field every run.
 */

export type CritterBand = "sky" | "ground";

export interface PlacedCritter {
  /** Orbit anchor X (corridor/slope/spawn-cleared). */
  x: number;
  /** Orbit anchor Z. */
  z: number;
  /** Orbit anchor Y (terrain height + band altitude offset). */
  baseY: number;
  /** Orbit radius. */
  radius: number;
  /** Angular rate (rad/s), signed. */
  speed: number;
  /** Start angle (rad). */
  phase: number;
  /** Orbit-plane inclination factor (altitude swing per orbit). */
  tilt: number;
  /** Sinusoidal altitude bob amplitude. */
  altAmp: number;
  /** Sinusoidal altitude bob frequency. */
  altFreq: number;
  /** Instance uniform scale. */
  scale: number;
  /** Reproducibility key (uint32). */
  seed: number;
  band: CritterBand;
}

export interface CritterPose {
  pos: THREE.Vector3;
  /** Facing direction (rad), tangent to the orbit. */
  yaw: number;
  scale: number;
}

export interface CritterOptions {
  seed: number;
  /** World spans [-worldHalfExtent, +worldHalfExtent] on X and Z. */
  worldHalfExtent: number;
  /** Inset from the world edge inside which nothing is placed. */
  edgeMargin: number;
  /** Jittered-grid cell size (metres). */
  cell: number;
  /** Max jittered candidates tried per grid slot before giving up on it. */
  maxAttemptsPerSlot: number;
  /** Extra clearance beyond the corridor edge kept clear of critters. */
  corridorMargin: number;
  /** Radius around the spawn point kept clear of critters. */
  spawnExclusionRadius: number;
  /** Max surface tilt (radians from vertical) for an anchor. */
  maxSlope: number;
  /** Cap on total critters placed. */
  count: number;
  /** Fraction (0..1) of critters in the sky band; remainder ground. */
  skyFraction: number;
}

/** Default critter field knobs, parity with Clouds/PropField (count 24). */
export function defaultCritterOptions(seed: number): CritterOptions {
  return {
    seed,
    worldHalfExtent: 100,
    edgeMargin: 4,
    cell: 6,
    maxAttemptsPerSlot: 4,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    count: 24,
    skyFraction: 0.6,
  };
}

/**
 * Deterministic jittered-grid critter sampler. Shuffles the world grid slots
 * with a single sub-seeded RNG, then tries up to `maxAttemptsPerSlot`
 * jittered candidates per slot, accepting the first that clears the
 * corridor, spawn, bounds, and slope gates. Stops once `count` critters are
 * placed. Same seed + same terrain -> identical placement every run.
 */
export function placeCritters(terrain: SamplerTerrain, opts: CritterOptions): PlacedCritter[] {
  const placed: PlacedCritter[] = [];
  const slots = buildSlots(opts);
  const spawn = terrain.startPos(new THREE.Vector3());
  const rng = makeRNG((opts.seed ^ hashSeed("critter")) >>> 0);
  const order = shuffleIndices(slots.length, rng);

  for (let i = 0; i < order.length && placed.length < opts.count; i++) {
    const slot = slots[order[i]]!;
    const hit = tryCritterSlot(terrain, opts, slot, rng, spawn);
    if (hit) placed.push(hit);
  }
  return placed;
}

/**
 * Pure orbit pose for a placed critter at time `t` (seconds). Position is the
 * anchor offset by an inclined circular orbit plus a sinusoidal altitude
 * bob; yaw faces tangent to the orbit. Reusing `out` avoids per-frame
 * allocations. Deterministic: same (p, t) -> identical pose.
 */
export function critterPose(p: PlacedCritter, t: number, out?: CritterPose): CritterPose {
  if (!out) out = { pos: new THREE.Vector3(), yaw: 0, scale: 1 };
  const angle = p.phase + p.speed * t;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const px = p.x + p.radius * cosA;
  const pz = p.z + p.radius * sinA;
  let py = p.baseY + p.radius * sinA * p.tilt;
  py += p.altAmp * Math.sin(p.altFreq * t + p.phase);
  const yaw = -angle;
  out.pos.set(px, py, pz);
  out.yaw = yaw;
  out.scale = p.scale;
  return out;
}

interface Slot {
  cx: number;
  cz: number;
}

function buildSlots(opts: CritterOptions): Slot[] {
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

function tryCritterSlot(
  terrain: SamplerTerrain,
  opts: CritterOptions,
  slot: Slot,
  rng: RNG,
  spawn: THREE.Vector3,
): PlacedCritter | null {
  const half = opts.cell / 2;
  for (let a = 0; a < opts.maxAttemptsPerSlot; a++) {
    const x = slot.cx + rng.unit() * half;
    const z = slot.cz + rng.unit() * half;
    if (outOfBounds(x, z, opts)) continue;

    if (terrain.corridorClearance(x, z) < opts.corridorMargin) continue;

    const dxs = x - spawn.x;
    const dzs = z - spawn.z;
    if (Math.hypot(dxs, dzs) < opts.spawnExclusionRadius) continue;

    const normal = terrain.normalAt(x, z, new THREE.Vector3());
    const surfaceTilt = Math.acos(clamp11(normal.y));
    if (surfaceTilt > opts.maxSlope) continue;

    const height = terrain.heightAt(x, z);
    const band: CritterBand = rng.next() < opts.skyFraction ? "sky" : "ground";
    let baseY: number;
    let radius: number;
    let altAmp: number;
    let altFreq: number;
    if (band === "sky") {
      baseY = height + rng.range(20, 34);
      radius = rng.range(10, 18);
      altAmp = rng.range(0.5, 2.0);
      altFreq = rng.range(0.2, 0.6);
    } else {
      baseY = height + rng.range(1.5, 3.5);
      radius = rng.range(3, 6);
      altAmp = rng.range(0.3, 1.0);
      altFreq = rng.range(0.3, 0.8);
    }
    const speed = rng.unit() * 0.8 + 0.3;
    const phase = rng.range(0, Math.PI * 2);
    const tilt = rng.range(0.1, 0.5);
    const scale = rng.range(0.8, 1.2);
    const seed = (rng.next() * 0x100000000) >>> 0;
    return { x, z, baseY, radius, speed, phase, tilt, altAmp, altFreq, scale, seed, band };
  }
  return null;
}

function outOfBounds(x: number, z: number, opts: CritterOptions): boolean {
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
