/**
 * Track graph primitives (059/060): SampleIndex (uniform bucket grid),
 * TrackEdge (equal-arc station table with per-station width), and TrackGraph
 * (mainline + branch edges with a global nearest-station query). The whole
 * race stack keys progress on one scalar t in [0,1) along the closed
 * mainline; branch edges PROJECT onto that parameterization (progressAt), so
 * every downstream consumer (checkpoints, ranking, HUD) is unchanged.
 *
 * Pure geometry (no WebGL, no three.js) -> jsdom/vitest-safe.
 */

import type { SplineTrack } from "./SplineTrack";

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

/**
 * Single source of the drivable corridor half-width baseline (m). Every
 * corridor consumer reads width from a GraphPose/FieldPose; this constant only
 * seeds constant-width edges (tests, legacy defaults) and the terrain config.
 */
export const DEFAULT_TRACK_HALF_WIDTH = 6;

export type EdgeKind = "main" | "shortcut" | "scenic";

/**
 * Piecewise-linear half-width along an edge: `s` (m, ascending, s[0] = 0) ->
 * `halfWidth` (m). Closed edges wrap the final segment back to s[0]+length.
 */
export interface WidthProfile {
  s: ReadonlyArray<number>;
  halfWidth: ReadonlyArray<number>;
}

/**
 * Evaluate a WidthProfile at arc position s (m) on an edge of `length` m.
 * Closed edges wrap s; open edges clamp to the end stations.
 */
export function widthProfileAt(
  profile: WidthProfile,
  s: number,
  length: number,
  closed = true,
): number {
  const n = profile.s.length;
  if (n === 0) return DEFAULT_TRACK_HALF_WIDTH;
  if (n === 1) return profile.halfWidth[0]!;
  if (!closed) {
    if (s <= profile.s[0]!) return profile.halfWidth[0]!;
    if (s >= profile.s[n - 1]!) return profile.halfWidth[n - 1]!;
  }
  const sw = ((s % length) + length) % length;
  // Binary search for the last station with station.s <= sw.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (profile.s[mid]! <= sw) lo = mid;
    else hi = mid - 1;
  }
  const i0 = lo;
  const i1 = (lo + 1) % n;
  const s0 = profile.s[i0]!;
  const s1 = i1 === 0 ? length : profile.s[i1]!;
  const span = s1 - s0;
  const f = span > 1e-9 ? (sw - s0) / span : 0;
  return profile.halfWidth[i0]! + (profile.halfWidth[i1]! - profile.halfWidth[i0]!) * f;
}

/** Wrap a loop parameter into [0,1). */
function wrapT(t: number): number {
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

/** Plain world point (THREE-free so the graph stays pure). */
export interface EdgePoint {
  x: number;
  y: number;
  z: number;
}

/** Target station spacing for resampled (branch) edges (m). */
export const EDGE_SAMPLE_STEP = 0.75;

/**
 * One drivable centerline with an equal-arc station table + per-station
 * half-width. The mainline edge is CLOSED and aliases the SplineTrack sample
 * arrays directly (station i == track sample i), so nearest-station queries
 * over the graph match SplineTrack.closestPoint bit-for-bit. Branch edges are
 * OPEN polylines resampled to ~EDGE_SAMPLE_STEP; their endpoints anchor at
 * mainline params tA/tB and progressAt projects onto the mainline
 * parameterization (t = tA..tB by fraction of branch length).
 */
export class TrackEdge {
  readonly id: number;
  readonly kind: EdgeKind;
  readonly closed: boolean;
  /** Total arc length (m). */
  readonly length: number;
  /** Mainline anchor params (closed mainline: tA=0, tB=1). */
  readonly tA: number;
  readonly tB: number;
  /** Equal-arc stations (world). Closed: spacing length/n, wraps. Open: inclusive endpoints. */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly sz: Float32Array;
  /** Half-width per station (m). */
  readonly hw: Float32Array;
  /** Arc spacing between consecutive stations (m). */
  readonly step: number;

  constructor(init: {
    id: number;
    kind: EdgeKind;
    closed: boolean;
    length: number;
    tA: number;
    tB: number;
    sx: Float32Array;
    sy: Float32Array;
    sz: Float32Array;
    hw: Float32Array;
  }) {
    this.id = init.id;
    this.kind = init.kind;
    this.closed = init.closed;
    this.length = init.length;
    this.tA = init.tA;
    this.tB = init.tB;
    this.sx = init.sx;
    this.sy = init.sy;
    this.sz = init.sz;
    this.hw = init.hw;
    this.step = init.closed ? init.length / init.sx.length : init.length / (init.sx.length - 1);
  }

  /** Station count. */
  get count(): number {
    return this.sx.length;
  }

  /** Clamp (open) or wrap (closed) an arc position into the edge domain. */
  private domain(s: number): number {
    if (this.closed) {
      const w = s % this.length;
      return w < 0 ? w + this.length : w;
    }
    return s < 0 ? 0 : s > this.length ? this.length : s;
  }

  /** Interpolated centerline point at arc position s (m). */
  pointAt(s: number, out: EdgePoint = { x: 0, y: 0, z: 0 }): EdgePoint {
    const n = this.sx.length;
    const f = this.domain(s) / this.step;
    const i0 = Math.min(Math.floor(f), this.closed ? n - 1 : n - 2);
    const i1 = this.closed ? (i0 + 1) % n : i0 + 1;
    const frac = f - i0;
    out.x = this.sx[i0]! + (this.sx[i1]! - this.sx[i0]!) * frac;
    out.y = this.sy[i0]! + (this.sy[i1]! - this.sy[i0]!) * frac;
    out.z = this.sz[i0]! + (this.sz[i1]! - this.sz[i0]!) * frac;
    return out;
  }

  /** Unit tangent (XZ-normalized, y slope included) at arc position s. */
  tangentAt(s: number, out: EdgePoint = { x: 0, y: 0, z: 0 }): EdgePoint {
    const n = this.sx.length;
    const f = this.domain(s) / this.step;
    const i = Math.min(Math.floor(f), this.closed ? n - 1 : n - 2);
    const i1 = this.closed ? (i + 1) % n : i + 1;
    const dx = this.sx[i1]! - this.sx[i]!;
    const dy = this.sy[i1]! - this.sy[i]!;
    const dz = this.sz[i1]! - this.sz[i]!;
    const len = Math.hypot(dx, dy, dz) || 1;
    out.x = dx / len;
    out.y = dy / len;
    out.z = dz / len;
    return out;
  }

  /** Half-width (m) at arc position s. */
  halfWidthAt(s: number): number {
    const n = this.sx.length;
    const f = this.domain(s) / this.step;
    const i0 = Math.min(Math.floor(f), this.closed ? n - 1 : n - 2);
    const i1 = this.closed ? (i0 + 1) % n : i0 + 1;
    const frac = f - i0;
    return this.hw[i0]! + (this.hw[i1]! - this.hw[i0]!) * frac;
  }

  /**
   * Mainline-projected lap fraction at arc position s. Closed mainline:
   * s/length (matches SplineTrack.st exactly at stations). Open branch:
   * wrap-lerp tA..tB by fraction of branch length, so progress is continuous
   * and monotonic along the branch and agrees with the mainline at both
   * junctions (a shorter branch accrues t faster per metre — by design).
   */
  progressAt(s: number): number {
    if (this.closed) return wrapT(this.domain(s) / this.length);
    const u = this.domain(s) / this.length;
    const span = wrapT(this.tB - this.tA) || 1;
    return wrapT(this.tA + span * u);
  }
}

/** Nearest-edge pose for a world (x, z) query over the whole graph. */
export interface GraphPose {
  edgeId: number;
  /** Arc distance along the edge (m). */
  s: number;
  /** Horizontal (XZ) distance to the nearest station (m). */
  dist: number;
  /** Mainline-projected lap fraction in [0,1). */
  t: number;
  /** Corridor half-width at the nearest station (m). */
  halfWidth: number;
  /** Centerline height at the nearest station. */
  pathY: number;
}

/** Branch edge construction input (sampled centerline, endpoints on mainline). */
export interface BranchEdgeInit {
  kind: "shortcut" | "scenic";
  /** Mainline params of the split/merge anchors (branch runs tA -> tB forward). */
  tA: number;
  tB: number;
  /** Dense sampled centerline points (>= 2), first/last ON the mainline. */
  points: ReadonlyArray<readonly [number, number, number]>;
  /** Constant half-width or a per-station profile (s in m along the branch). */
  halfWidth: number | WidthProfile;
}

/** Resample an open polyline to equal-arc stations at ~EDGE_SAMPLE_STEP. */
function resampleOpen(points: BranchEdgeInit["points"]): {
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
  length: number;
} {
  const m = points.length;
  const prefix = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    prefix[i] = prefix[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const length = prefix[m - 1]!;
  const count = Math.max(2, Math.round(length / EDGE_SAMPLE_STEP) + 1);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sz = new Float32Array(count);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (length * i) / (count - 1);
    while (seg < m - 2 && prefix[seg + 1]! < target) seg++;
    const s0 = prefix[seg]!;
    const s1 = prefix[seg + 1]!;
    const f = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
    const a = points[seg]!;
    const b = points[seg + 1]!;
    sx[i] = a[0] + (b[0] - a[0]) * f;
    sy[i] = a[1] + (b[1] - a[1]) * f;
    sz[i] = a[2] + (b[2] - a[2]) * f;
  }
  return { sx, sy, sz, length };
}

/**
 * Distance window over which two nearby edges RIDGE-BLEND their path
 * heights: within it, pathY mixes toward the midpoint as the gap between
 * the nearest and second-nearest edge closes (50/50 exactly on the
 * equidistant ridge), so junction terrain has no crease when routes carve
 * at different heights (060).
 */
export const RIDGE_BLEND = 24;

/**
 * The world's drivable network: edge 0 wraps the mainline SplineTrack
 * (closed); optional branch edges (open) anchor at mainline params.
 * closestOnGraph returns the TRUE nearest edge station over all edges (one
 * SampleIndex per edge; 059 single edge is bit-identical to the old flat
 * index) with ridge-blended pathY; generation-time separation guarantees
 * nearest-edge is never ambiguous for an on-corridor kart.
 */
export class TrackGraph {
  readonly main: SplineTrack;
  readonly edges: ReadonlyArray<TrackEdge>;
  readonly loopLength: number;
  /** Per-edge nearest-station index (parallel to edges). */
  private readonly indexes: ReadonlyArray<SampleIndex>;

  constructor(
    track: SplineTrack,
    opts: {
      mainWidth?: number | WidthProfile;
      branches?: ReadonlyArray<BranchEdgeInit>;
    } = {},
  ) {
    this.main = track;
    this.loopLength = track.loopLength;
    const edges: TrackEdge[] = [];

    const n = track.sx.length;
    const mainStep = track.loopLength / n;
    edges.push(
      new TrackEdge({
        id: 0,
        kind: "main",
        closed: true,
        length: track.loopLength,
        tA: 0,
        tB: 1,
        sx: track.sx,
        sy: track.sy,
        sz: track.sz,
        hw: buildHw(n, (i) => i * mainStep, track.loopLength, opts.mainWidth),
      }),
    );

    for (const b of opts.branches ?? []) {
      const r = resampleOpen(b.points);
      const step = r.length / (r.sx.length - 1);
      edges.push(
        new TrackEdge({
          id: edges.length,
          kind: b.kind,
          closed: false,
          length: r.length,
          tA: b.tA,
          tB: b.tB,
          sx: r.sx,
          sy: r.sy,
          sz: r.sz,
          hw: buildHw(r.sx.length, (i) => i * step, r.length, b.halfWidth, false),
        }),
      );
    }
    this.edges = edges;
    this.indexes = edges.map((e) => new SampleIndex(e.sx, e.sz));
  }

  /** Edge lookup by id (id == array index by construction). */
  edgeById(id: number): TrackEdge {
    return this.edges[id]!;
  }

  /**
   * Nearest edge station to world (x, z) over ALL edges (ties -> lowest edge
   * id then lowest station, matching the old flat-index rule). pathY is
   * ridge-blended toward the second-nearest DISTINCT edge inside RIDGE_BLEND;
   * every other field comes from the nearest edge alone. With a single edge
   * this matches SplineTrack.closestPoint exactly (same table, same tie rule,
   * no blend partner).
   */
  closestOnGraph(
    x: number,
    z: number,
    out: GraphPose = { edgeId: 0, s: 0, dist: 0, t: 0, halfWidth: 0, pathY: 0 },
  ): GraphPose {
    let bestEdge = 0;
    let bestI = 0;
    let bestD = Infinity;
    let otherD = Infinity;
    let otherY = 0;
    for (let ei = 0; ei < this.edges.length; ei++) {
      const i = this.indexes[ei]!.nearestSample(x, z);
      const d = this.indexes[ei]!.sampleDistSq(i, x, z);
      if (d < bestD) {
        if (bestD < otherD) {
          otherD = bestD;
          otherY = this.edges[bestEdge]!.sy[bestI]!;
        }
        bestD = d;
        bestEdge = ei;
        bestI = i;
      } else if (d < otherD) {
        otherD = d;
        otherY = this.edges[ei]!.sy[i]!;
      }
    }
    const e = this.edges[bestEdge]!;
    out.edgeId = e.id;
    out.s = bestI * e.step;
    out.dist = Math.sqrt(bestD);
    // Closed-edge station t is i/n EXACTLY (bit-matches SplineTrack.st[i]);
    // progressAt(i*step) would drift by an ulp through the metre round-trip.
    out.t = e.closed ? bestI / e.count : e.progressAt(out.s);
    out.halfWidth = e.hw[bestI]!;
    out.pathY = e.sy[bestI]!;
    if (otherD < Infinity) {
      const gap = Math.sqrt(otherD) - out.dist;
      if (gap < RIDGE_BLEND) {
        const w = 0.5 * (1 - gap / RIDGE_BLEND);
        out.pathY += (otherY - out.pathY) * w;
      }
    }
    return out;
  }
}

/** Build a per-station half-width table from a constant or a WidthProfile. */
function buildHw(
  count: number,
  sAt: (i: number) => number,
  length: number,
  width: number | WidthProfile | undefined,
  closed = true,
): Float32Array {
  const hw = new Float32Array(count);
  if (typeof width === "number" || width === undefined) {
    hw.fill(width ?? DEFAULT_TRACK_HALF_WIDTH);
    return hw;
  }
  for (let i = 0; i < count; i++) hw[i] = widthProfileAt(width, sAt(i), length, closed);
  return hw;
}
