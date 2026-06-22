/**
 * Deterministic pseudo-random utilities for procedural placement (004
 * environment dressing). All output is a pure function of the seed: the same
 * seed reproduces the same sequence and the same prop field every run.
 *
 * Canonical home for mulberry32 + the small math helpers (smoothstep/clamp01)
 * the samplers and factories consume. 003's heightmap/noise ship their own
 * private copies of these (predates this module); consolidating 003 onto here
 * is a non-blocking cross-backlog note, not part of 004.
 */

/** Clamp to [0,1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Cubic Hermite smoothstep. Returns 0 below e0, 1 above e1, C1-smooth between.
 * Degenerate edge (e0==e1) is a hard step to avoid divide-by-zero.
 */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * mulberry32: tiny, fast, deterministic 32-bit PRNG. `seed` is coerced to an
 * unsigned 32-bit int. Returns a generator producing floats in [0,1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RNG {
  /** Original uint32 seed (sub-seeds derive from it deterministically). */
  readonly seed: number;
  /** Next float in [0,1). */
  next(): number;
  /** Float in [min,max). */
  range(min: number, max: number): number;
  /** Signed jitter in [-1,1) — symmetric, for placement/scale offsets. */
  unit(): number;
  /** Uniform random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
}

/**
 * Build a deterministic RNG bound to `seed`. The helpers are thin wrappers over
 * mulberry32 so consumers stay terse at call sites (propSampler/propFactory).
 */
export function makeRNG(seed: number): RNG {
  const gen = mulberry32(seed);
  return {
    seed: seed >>> 0,
    next: gen,
    range: (min, max) => min + gen() * (max - min),
    unit: () => gen() * 2 - 1,
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error("RNG.pick: empty array");
      return arr[Math.floor(gen() * arr.length)]!;
    },
  };
}

/**
 * FNV-1a 32-bit string hash -> uint32. Stable across runs/runtimes so string
 * labels (prop-type names, region keys) map to reproducible sub-seeds without
 * callers hand-picking integers.
 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
