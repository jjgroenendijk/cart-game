import { chunkCenter, nearestFocusDistanceXZ, parseChunkKey } from "./streamGrid";
import type { Pt } from "../kart/kartLod";

/** Origin point for the ctor seed ordering (nearest-to-world-center first). */
const ORIGIN: readonly Pt[] = [{ x: 0, y: 0, z: 0 }];

/** A chunk chosen for seeding: grid coords + XZ center + ordering distance. */
export interface SeedCandidate {
  key: string;
  gx: number;
  gz: number;
  x: number;
  z: number;
  /** XZ distance to the nearest ordering focus (origin, cameras, or foci). */
  d: number;
}

/**
 * Order chunk keys by XZ distance to `foci` nearest-first, key tie-break for
 * determinism. `skip(key)` drops keys already made active (a pending chunk a
 * concurrent stream/prime pass already built) for free.
 */
function orderSeed(
  keys: Iterable<string>,
  chunkSize: number,
  foci: readonly Pt[],
  skip?: (key: string) => boolean,
): SeedCandidate[] {
  const out: SeedCandidate[] = [];
  for (const key of keys) {
    if (skip?.(key)) continue;
    const { gx, gz } = parseChunkKey(key);
    const c = chunkCenter(gx, gz, chunkSize);
    out.push({ key, gx, gz, x: c.x, z: c.z, d: nearestFocusDistanceXZ(c.x, c.z, foci) });
  }
  out.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * 206 incremental seed queue. Owns the deferred chunk keys + the per-frame
 * budget; each method PLANS (returns the chunks to build now) and mutates the
 * pending queue, leaving the actual mesh/collider build + LOD tier resolution to
 * TerrainChunkManager. `budget` caps both the synchronous ctor seed and the
 * per-frame drain; Infinity reproduces the pre-206 synchronous full seed.
 */
export class ChunkSeeder {
  private pending: string[] = [];

  constructor(
    private readonly chunkSize: number,
    private readonly budget: number,
  ) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Order the origin-desired keys nearest-to-origin, return the first `budget`
   * to seed now, and enqueue the rest. Candidate `d` is the origin distance
   * (its LOD tier at settle).
   */
  seedInitial(desired: Iterable<string>): SeedCandidate[] {
    const ordered = orderSeed(desired, this.chunkSize, ORIGIN);
    const take = ordered.slice(0, Math.min(this.budget, ordered.length));
    this.pending = ordered.slice(take.length).map((o) => o.key);
    return take;
  }

  /**
   * Return up to `budget` still-pending chunks nearest the cameras (skipping any
   * already active), and drop them from the queue. Candidate `d` is the XZ
   * camera distance; the caller resolves the LOD tier from the 3D distance.
   */
  drain(cameras: readonly Pt[], isActive: (key: string) => boolean): SeedCandidate[] {
    if (this.pending.length === 0) return [];
    const ordered = orderSeed(this.pending, this.chunkSize, cameras, isActive);
    const take = ordered.slice(0, Math.min(this.budget, ordered.length));
    const taken = new Set(take.map((o) => o.key));
    this.pending = ordered.filter((o) => !taken.has(o.key)).map((o) => o.key);
    return take;
  }

  /**
   * Return every still-pending chunk within `radius` (XZ) of any focus (skipping
   * already-active keys), keeping the rest pending. Candidate `d` is the focus
   * distance (gameplay chunks near a kart -> near tier).
   */
  prime(foci: readonly Pt[], radius: number, isActive: (key: string) => boolean): SeedCandidate[] {
    if (this.pending.length === 0) return [];
    const take: SeedCandidate[] = [];
    const rest: string[] = [];
    for (const c of orderSeed(this.pending, this.chunkSize, foci, isActive)) {
      if (c.d <= radius) take.push(c);
      else rest.push(c.key);
    }
    this.pending = rest;
    return take;
  }
}
