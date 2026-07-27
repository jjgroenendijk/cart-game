/**
 * Track graph primitives (059/060): SampleIndex (uniform bucket grid, in
 * `sampleIndex.ts`; re-exported below), TrackEdge (equal-arc station table
 * with per-station width), and TrackGraph (mainline + branch edges with a
 * global nearest-station query). The whole race stack keys progress on one
 * scalar t in [0,1) along the closed mainline; branch edges PROJECT onto
 * that parameterization (progressAt), so every downstream consumer
 * (checkpoints, ranking, HUD) is unchanged.
 *
 * Pure geometry (no WebGL, no three.js) -> jsdom/vitest-safe.
 */

import type { SplineTrack } from "./SplineTrack";

// SampleIndex (uniform bucket grid) lives in sampleIndex.ts; re-exported here
// so existing importers (circuit/branch/bank + tests) keep their import paths.
export { SampleIndex } from "./sampleIndex";
import { SampleIndex } from "./sampleIndex";

// Station-profile primitives live in stationProfile.ts; re-exported here so
// the many existing importers (circuit, heightmap, aiSpeed, KartGrid, ...)
// keep their import paths.
export {
  DEFAULT_TRACK_HALF_WIDTH,
  widthProfileAt,
  type BankProfile,
  type WidthProfile,
} from "./stationProfile";
import {
  buildStationTable,
  DEFAULT_TRACK_HALF_WIDTH,
  type BankProfile,
  type WidthProfile,
} from "./stationProfile";

export type EdgeKind = "main" | "shortcut" | "scenic";

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
  /** Signed bank per station (rad, + = left raised; 084). Zeros = level. */
  readonly bank: Float32Array;
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
    bank?: Float32Array;
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
    this.bank = init.bank ?? new Float32Array(init.sx.length);
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

  /** Signed bank (rad, + = left raised) at arc position s (084). */
  bankAt(s: number): number {
    const n = this.sx.length;
    const f = this.domain(s) / this.step;
    const i0 = Math.min(Math.floor(f), this.closed ? n - 1 : n - 2);
    const i1 = this.closed ? (i0 + 1) % n : i0 + 1;
    const frac = f - i0;
    return this.bank[i0]! + (this.bank[i1]! - this.bank[i0]!) * frac;
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
      /** Mainline bank profile (084); undefined = level. Branches stay level. */
      mainBank?: BankProfile;
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
        bank: opts.mainBank
          ? buildStationTable(
              n,
              (i) => i * mainStep,
              track.loopLength,
              { s: opts.mainBank.s, v: opts.mainBank.bank },
              0,
            )
          : undefined,
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
  const source =
    typeof width === "object" && width !== null ? { s: width.s, v: width.halfWidth } : width;
  return buildStationTable(count, sAt, length, source, DEFAULT_TRACK_HALF_WIDTH, closed);
}
