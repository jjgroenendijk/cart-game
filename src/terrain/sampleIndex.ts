/**
 * Generic uniform XZ bucket-grid spatial index over a set of point samples.
 * Pure (numbers + typed arrays only; no THREE, no SplineTrack dependency) so
 * it is jsdom/vitest-safe and reusable beyond the track graph. Re-exported
 * from `trackGraph.ts` so existing importers keep their import paths.
 */

/**
 * Uniform XZ bucket grid over a set of point samples. nearestSample(x, z)
 * returns the index of the nearest sample by squared XZ distance via an
 * expanding-ring bucket search that is guaranteed to find the TRUE global
 * nearest, so it matches an exhaustive linear scan exactly (ties -> lowest
 * index, mirroring SplineTrack.closestPoint).
 */
export class SampleIndex {
  private readonly sx: ArrayLike<number>;
  private readonly sz: ArrayLike<number>;
  private readonly cell: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: ReadonlyArray<number[] | undefined>;
  /** World bounds of the indexed samples (min inclusive). */
  readonly bounds: Readonly<{
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  }>;

  constructor(sx: ArrayLike<number>, sz: ArrayLike<number>, cell = 16) {
    if (sx.length !== sz.length) {
      throw new Error("SampleIndex: sx/sz length mismatch");
    }
    const n = sx.length;
    this.sx = sx;
    this.sz = sz;
    this.cell = cell;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = sx[i];
      const pz = sz[i];
      if (px < minX) minX = px;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (pz > maxZ) maxZ = pz;
    }
    this.minX = minX;
    this.minZ = minZ;
    this.bounds = { minX, minZ, maxX, maxZ };
    const cols = n === 0 ? 1 : Math.max(1, Math.floor((maxX - minX) / cell) + 1);
    const rows = n === 0 ? 1 : Math.max(1, Math.floor((maxZ - minZ) / cell) + 1);
    this.cols = cols;
    this.rows = rows;
    const buckets: Array<number[] | undefined> = new Array(cols * rows);
    for (let i = 0; i < n; i++) {
      const bx = Math.floor((sx[i] - minX) / cell);
      const bz = Math.floor((sz[i] - minZ) / cell);
      const k = bz * cols + bx;
      const b = buckets[k];
      if (b) b.push(i);
      else buckets[k] = [i];
    }
    this.buckets = buckets;
  }

  /** Number of indexed samples. */
  get count(): number {
    return this.sx.length;
  }

  /**
   * Index of the nearest sample to (x, z) by squared XZ distance, or -1 if the
   * index holds no samples. Expands ring-by-ring from the query's bucket and
   * stops once the next ring's closest possible squared distance exceeds the
   * best found, which guarantees the true global nearest. Ties resolve to the
   * lowest index (same rule as SplineTrack.closestPoint), so output matches an
   * exhaustive linear scan bit-for-bit.
   */
  nearestSample(x: number, z: number): number {
    const n = this.sx.length;
    if (n === 0) return -1;
    const { cell, minX, minZ, cols, rows, sx, sz, buckets } = this;
    const qx = Math.floor((x - minX) / cell);
    const qz = Math.floor((z - minZ) / cell);
    const maxRing = Math.max(
      Math.abs(qx),
      Math.abs(qx - (cols - 1)),
      Math.abs(qz),
      Math.abs(qz - (rows - 1)),
    );
    let best = -1;
    let bestD = Infinity;
    const visit = (bx: number, bz: number): void => {
      if (bx < 0 || bx >= cols || bz < 0 || bz >= rows) return;
      const b = buckets[bz * cols + bx];
      if (!b) return;
      for (let k = 0; k < b.length; k++) {
        const idx = b[k];
        const dx = x - sx[idx];
        const dz = z - sz[idx];
        const d = dx * dx + dz * dz;
        if (d < bestD || (d === bestD && idx < best)) {
          bestD = d;
          best = idx;
        }
      }
    };
    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring === 0) {
        visit(qx, qz);
      } else {
        for (let bx = qx - ring; bx <= qx + ring; bx++) {
          visit(bx, qz - ring);
          visit(bx, qz + ring);
        }
        for (let bz = qz - ring + 1; bz <= qz + ring - 1; bz++) {
          visit(qx - ring, bz);
          visit(qx + ring, bz);
        }
      }
      if (best >= 0) {
        const gap = ring * cell;
        if (gap * gap > bestD) break;
      }
    }
    return best;
  }

  /** Squared XZ distance from (x, z) to sample i (no bounds check). */
  sampleDistSq(i: number, x: number, z: number): number {
    const dx = x - this.sx[i];
    const dz = z - this.sz[i];
    return dx * dx + dz * dz;
  }

  /**
   * Visit every sample within radius `r` of (x, z): cb(index, distSq). Scans
   * only the buckets overlapping the disc, so radius queries over all samples
   * (separation / self-intersection validation) stay near-linear instead of
   * O(n^2).
   */
  forEachWithin(x: number, z: number, r: number, cb: (i: number, dSq: number) => void): void {
    const { cell, minX, minZ, cols, rows, sx, sz, buckets } = this;
    const rSq = r * r;
    const bx0 = Math.max(0, Math.floor((x - r - minX) / cell));
    const bx1 = Math.min(cols - 1, Math.floor((x + r - minX) / cell));
    const bz0 = Math.max(0, Math.floor((z - r - minZ) / cell));
    const bz1 = Math.min(rows - 1, Math.floor((z + r - minZ) / cell));
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = buckets[bz * cols + bx];
        if (!b) continue;
        for (let k = 0; k < b.length; k++) {
          const idx = b[k]!;
          const dx = x - sx[idx];
          const dz = z - sz[idx];
          const dSq = dx * dx + dz * dz;
          if (dSq <= rSq) cb(idx, dSq);
        }
      }
    }
  }
}
