import type { RNG } from "../core/rng";
import {
  arcPoints,
  convexHull,
  curveLengthXZ,
  displaceOnce,
  dropSpikes,
  enforceMinEdge,
  filletCorners,
  perimeter,
  prefixArc,
  rayClearance,
  relaxTwoTier,
  signedArea,
  smoothLoop,
  subdivideLong,
  MAX_SEG,
  MIN_EDGE,
  type CornerMix,
  type V2,
} from "./circuitShape";

export interface CircuitPlan {
  control: ReadonlyArray<readonly [number, number, number]>;
  worldSize: number;
  length: number;
}

export interface MainlineOpts {
  /** Midpoint-displacement amplitude as a signed fraction of each edge length. */
  dispAmpRange?: readonly [number, number];
  /** Ellipse elongation range for the scatter footprint. */
  elongRange?: readonly [number, number];
  /** 0..1 scale on fold depth + chicane width (taming knob). */
  featureScale?: number;
  /** Max hairpin bays carved into straights (taming lowers it). */
  maxFolds?: number;
  /** Base hairpin-bay count the fold draw offsets from (archetype knob). */
  minFolds?: number;
  /** [base, max] chicane count for the chicane draw (archetype knob). */
  chicaneRange?: readonly [number, number];
  /** Target lap length range (m) the L draw samples from. */
  lengthRange?: readonly [number, number];
  /** Hard/medium/sweeper weights for the per-corner radius draw. */
  cornerMix?: CornerMix;
  /** Laplacian anti-kink factor, two iterations (taming raises it). */
  smoothFactor?: number;
  /** Multiplier on the elevation amplitude (biome/archetype character). */
  elevAmpScale?: number;
  /** 0..1 weight of a guaranteed 1-cycle climb/descent harmonic. */
  elevHillBias?: number;
  /** Max |dY| per metre of XZ arc between control points. */
  gradeMax?: number;
  /**
   * Minimum control-point Y (metres). When set (from the biome water level +
   * ROAD_WATER_CLEARANCE), valley control points are lifted to this floor so
   * the playable road surface (pathY) never dips below the water plane.
   * Applied after cohereElevation; undefined = unconstrained (legacy).
   */
  elevationFloor?: number;
}

const MARGIN = 30;
const TWO_PI = Math.PI * 2;

/**
 * Default mainline grade ceiling (rise per metre of XZ arc). Sits below the
 * branch cap (BRANCH_GRADE_MAX = 0.2) so the mainline always reads gentler
 * than its shortcuts, with headroom to what the kart can climb.
 */
export const MAIN_GRADE_MAX = 0.14;

// Hairpin bays (folds): parallel legs 2*apexR apart joined by an exact
// sampled semicircle, entered through 90-degree mouth fillets. All three
// radii are explicit, so a fold can never kink below the floor. Radii carry
// headroom over the 12.5 m floor because the exact-length trim may shrink
// the whole loop by up to ~10%.
const FOLD_MIN_EDGE = 82;
const FOLD_APEX_R_MIN = 17;
const FOLD_APEX_R_MAX = 25;
const FOLD_MOUTH_R_MIN = 14;
const FOLD_MOUTH_R_MAX = 17;
/** Typical arc length one fold adds (legs + apex + mouths - removed span). */
const FOLD_LENGTH_COST = 140;
const CHICANE_MIN_EDGE = 70;

interface Carve {
  /** Edge start index (edge = idx -> idx+1). */
  idx: number;
  kind: "fold" | "chicane";
}

/**
 * Pick non-adjacent host edges for folds (longest first, len >= FOLD_MIN_EDGE)
 * then chicanes (len >= CHICANE_MIN_EDGE). After filleting, only genuine
 * straights are long enough to qualify (arc segments are short). Returns
 * carves sorted by descending index so insertion never shifts a pending host.
 */
function pickCarves(pts: ReadonlyArray<V2>, folds: number, chicanes: number): Carve[] {
  const n = pts.length;
  const lens: Array<{ idx: number; len: number; mid: V2 }> = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    lens.push({
      idx: i,
      len: Math.hypot(q[0] - p[0], q[1] - p[1]),
      mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
    });
  }
  lens.sort((a, b) => b.len - a.len);
  const usedMids: V2[] = [];
  const carves: Carve[] = [];
  const take = (kind: Carve["kind"], want: number, minLen: number): void => {
    let got = 0;
    for (const e of lens) {
      if (got >= want || e.len < minLen) continue;
      // Distance-based exclusion: two carves too close (e.g. edges separated
      // only by a short arc) would collide even though non-adjacent by index.
      let tooClose = false;
      for (const m of usedMids) {
        if (Math.hypot(m[0] - e.mid[0], m[1] - e.mid[1]) < e.len / 2 + 90) tooClose = true;
      }
      if (tooClose) continue;
      usedMids.push(e.mid);
      carves.push({ idx: e.idx, kind });
      got++;
    }
  };
  take("fold", folds, FOLD_MIN_EDGE);
  take("chicane", chicanes, CHICANE_MIN_EDGE);
  return carves.sort((a, b) => b.idx - a.idx);
}

/**
 * Carve a hairpin bay into straight edge (idx -> idx+1) as a keyhole: two
 * 90-degree mouth fillets on the edge, parallel legs 2*apexR apart diving
 * inward, and an exact sampled semicircular apex. All radii are explicit
 * (mouth 14-17 m, apex 17-25 m), so the U-turn cannot kink below the floor.
 * Depth is capped by ray clearance to the opposite side of the loop;
 * too-hemmed edges are skipped (returns false).
 */
function carveFold(pts: V2[], idx: number, rng: RNG, scale: number): boolean {
  const n = pts.length;
  const a = pts[idx]!;
  const b = pts[(idx + 1) % n]!;
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len = Math.hypot(ex, ey);
  const ux = ex / len;
  const uy = ey / len;
  // CCW polygon: interior is left of travel -> inward normal = rot90(u).
  const nx = -uy;
  const ny = ux;
  const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const rm = rng.range(FOLD_MOUTH_R_MIN, FOLD_MOUTH_R_MAX);
  // Apex radius adapts to the host: big straights get sweeping hairpins,
  // shorter ones tighten toward the floor instead of skipping the fold.
  const rCap = len / 2 - 12 - rm;
  if (rCap < FOLD_APEX_R_MIN) return false;
  const r = Math.min(rng.range(19, FOLD_APEX_R_MAX), rCap);
  const wantDepth = scale * rng.range(0.5, 0.85) * len;
  const skip = new Set<number>([idx, (idx + 1) % n]);
  // Fan of three inward rays (mid + both mouths): a single mid ray misses
  // walls the legs would still hit diagonally.
  const foot = r + rm;
  const clearance = Math.min(
    rayClearance(pts, mid, [nx, ny], skip),
    rayClearance(pts, [mid[0] - ux * foot, mid[1] - uy * foot], [nx, ny], skip),
    rayClearance(pts, [mid[0] + ux * foot, mid[1] + uy * foot], [nx, ny], skip),
  );
  const depth = Math.min(wantDepth, clearance * 0.42);
  // Depth must fit mouth fillet + a real leg + the apex semicircle.
  if (depth < r + rm + 18) return false;
  // Local frame: pt(s, d) = mid + u*s + n*d (s along edge, d inward).
  const pt = (s: number, d: number): V2 => [mid[0] + ux * s + nx * d, mid[1] + uy * s + ny * d];
  const bay: V2[] = [];
  const pushArc = (c: V2, radius: number, a0: number, sweep: number): void => {
    for (const p of arcPoints(0, 0, radius, a0, sweep)) {
      bay.push(pt(c[0] + p[0], c[1] + p[1]));
    }
  };
  // Left mouth fillet: heading +u turns 90 deg left into +n. Tangent points
  // edge (-r-rm, 0) -> leg (-r, rm); center (-r-rm, rm).
  pushArc([-(r + rm), rm], rm, -Math.PI / 2, Math.PI / 2);
  // Apex semicircle: center (0, depth - r), from the left leg (angle PI)
  // clockwise (right-hand U-turn) to the right leg (angle 0).
  pushArc([0, depth - r], r, Math.PI, -Math.PI);
  // Right mouth fillet: heading -n turns 90 deg left into +u.
  pushArc([r + rm, rm], rm, Math.PI, Math.PI / 2);
  pts.splice(idx + 1, 0, ...bay);
  return true;
}

/** Carve an S-flick into edge (idx -> idx+1): +w / -w lateral offsets. */
function carveChicane(pts: V2[], idx: number, rng: RNG, scale: number): void {
  const n = pts.length;
  const a = pts[idx]!;
  const b = pts[(idx + 1) % n]!;
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len = Math.hypot(ex, ey);
  const nx = -ey / len;
  const ny = ex / len;
  const w = scale * Math.min(12, 0.13 * len) * (rng.next() < 0.5 ? 1 : -1) * rng.range(0.75, 1.1);
  const at = (frac: number, d: number): V2 => [
    a[0] + ex * frac + nx * d,
    a[1] + ey * frac + ny * d,
  ];
  pts.splice(idx + 1, 0, at(0.3, w), at(0.7, -w));
}

function elevationProfile(n: number, amp: number, rng: RNG, hillBias: number): number[] {
  const fA = rng.range(0.5, 1.5);
  const pA = rng.range(0, TWO_PI);
  const fB = rng.range(1.0, 2.5);
  const pB = rng.range(0, TWO_PI);
  // The hill phase is always drawn so the rng sequence is bias-independent.
  const pH = rng.range(0, TWO_PI);
  const ys: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const v =
      (Math.sin(TWO_PI * fA * u + pA) + 0.5 * Math.sin(TWO_PI * fB * u + pB)) / 1.5 +
      hillBias * Math.sin(TWO_PI * u + pH);
    ys[i] = (amp * v) / (1 + hillBias);
  }
  return ys;
}

/**
 * Raise-only grade limiter on the closed control ring: wherever |dY| between
 * consecutive points exceeds gradeMax * XZ segment length, the LOWER point is
 * raised to the cap. Raising (never sinking) preserves the later water floor;
 * heights are bounded by the ring maximum, so the sweep converges.
 */
function relaxGrade(pts: ReadonlyArray<V2>, ys: number[], gradeMax: number): void {
  const n = pts.length;
  const { prefix, total } = prefixArc(pts);
  const seg = (i: number): number =>
    i + 1 < n ? prefix[i + 1]! - prefix[i]! : total - prefix[n - 1]!;
  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const cap = gradeMax * Math.max(seg(i), 1e-6);
      const d = ys[j]! - ys[i]!;
      if (d > cap) {
        ys[i] = ys[j]! - cap;
        changed = true;
      } else if (d < -cap) {
        ys[j] = ys[i]! - cap;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * Pull heights together for XZ-near but arc-far control pairs (hairpin legs,
 * bay mouths). Two roads 20-46 m apart share the same terrain blend zone; a
 * big height gap there reads as a cliff between the legs, so their heights
 * converge in proportion to XZ closeness.
 */
function cohereElevation(pts: ReadonlyArray<V2>, ys: number[]): void {
  const n = pts.length;
  const { prefix, total } = prefixArc(pts);
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const raw = prefix[j]! - prefix[i]!;
        const gap = Math.min(raw, total - raw);
        if (gap < 50) continue;
        const a = pts[i]!;
        const b = pts[j]!;
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d >= 48) continue;
        const w = 0.6 * (1 - d / 48);
        const mean = (ys[i]! + ys[j]!) / 2;
        ys[i]! += (mean - ys[i]!) * w;
        ys[j]! += (mean - ys[j]!) * w;
      }
    }
  }
}

/**
 * Pure seeded mainline construction. Skeleton: interior scatter in a rotated
 * ellipse -> convex hull (5-9 genuine corners) pre-scaled to a feature-
 * budgeted share of the target length -> per-corner tangent-arc fillets
 * (hard/medium/sweeper radius mix). Features carved in metres on the
 * remaining straights: keyhole hairpin bays and chicanes; then subdivision,
 * signed midpoint displacement x2, exact length normalize, anti-kink
 * smoothing, two-tier push-apart, a final exact length trim, and the
 * elevation profile + coherence + grade-relax passes. All randomness flows from `rng`;
 * same rng -> same plan.
 */
export function buildMainline(rng: RNG, opts: MainlineOpts = {}): CircuitPlan {
  const [dLo, dHi] = opts.dispAmpRange ?? [0.05, 0.13];
  const [eLo, eHi] = opts.elongRange ?? [1.0, 1.45];
  const featureScale = opts.featureScale ?? 1;
  const maxFolds = opts.maxFolds ?? 3;
  const minFolds = opts.minFolds ?? 1;
  const [cLo, cHi] = opts.chicaneRange ?? [1, 2];
  const [lLo, lHi] = opts.lengthRange ?? [600, 1500];
  const smoothFactor = opts.smoothFactor ?? 0.14;

  const L = rng.range(lLo, lHi);
  const M = 9 + Math.floor(rng.next() * 6);
  const dispAmp = rng.range(dLo, dHi);
  const elong = rng.range(eLo, eHi);
  const rot = rng.range(0, Math.PI);
  // Feature counts are drawn up front so the skeleton perimeter can budget
  // for the length they add. Without this, feature-heavy short loops get
  // shrunk hard by the exact-length trim, dragging arc radii below the
  // drivability floor. Draw shapes are archetype-independent (one call
  // each, offset from the base count) so retries stay draw-aligned; the
  // defaults reproduce the pre-archetype draws exactly.
  const wantFolds = Math.min(maxFolds, minFolds + Math.floor(rng.next() * 3));
  const wantChicanes = Math.min(cHi, cLo + Math.floor(rng.next() * 2));
  const budget = (wantFolds * FOLD_LENGTH_COST + wantChicanes * 12) / L;
  const alpha = Math.min(0.93, Math.max(0.5, 1 - 0.045 - budget));
  const base = (L * alpha) / TWO_PI;

  // Interior scatter (uniform in a rotated ellipse). Interior, not boundary:
  // boundary scatter degenerates the hull into the ellipse itself (the old
  // "boring oval" failure); interior scatter yields 5-9 genuine corners.
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const scatter: V2[] = new Array(M);
  for (let i = 0; i < M; i++) {
    const r = Math.sqrt(rng.next());
    const th = rng.next() * TWO_PI;
    const px = base * elong * r * Math.cos(th);
    const py = (base / elong) * r * Math.sin(th);
    scatter[i] = [px * cosR - py * sinR, px * sinR + py * cosR];
  }

  let hull = convexHull(scatter);
  if (hull.length < 5) {
    hull = scatter
      .map((p) => ({ p, a: Math.atan2(p[1], p[0]) }))
      .sort((x, y) => x.a - y.a)
      .map((x) => x.p);
  }
  // Force CCW so the fold inward normal is consistent.
  if (signedArea(hull) < 0) hull.reverse();

  // Pre-scale the skeleton so feature/fillet sizes below are in real metres,
  // and clean the polygon BEFORE arc insertion: a min-edge pass afterwards
  // would eat the deliberately close arc samples.
  const preK = (L * alpha) / perimeter(hull);
  let pts: V2[] = hull.map((p) => [p[0] * preK, p[1] * preK]);
  pts = enforceMinEdge(pts, MIN_EDGE);
  pts = dropSpikes(pts);
  pts = filletCorners(pts, rng, opts.cornerMix);

  for (const carve of pickCarves(pts, wantFolds, wantChicanes)) {
    if (carve.kind === "fold") carveFold(pts, carve.idx, rng, featureScale);
    else carveChicane(pts, carve.idx, rng, featureScale);
  }

  pts = subdivideLong(pts, MAX_SEG);
  pts = displaceOnce(pts, dispAmp, rng);
  pts = displaceOnce(pts, dispAmp / 2, rng);

  // Normalize to the target length so relax thresholds act in final metres.
  const k0 = L / curveLengthXZ(pts);
  pts = pts.map((p) => [p[0] * k0, p[1] * k0]);

  pts = smoothLoop(pts, 2, smoothFactor);
  pts = relaxTwoTier(pts, 6);

  // Smoothing + relax drift the length a little; trim back to exactly L.
  const k1 = L / curveLengthXZ(pts);
  pts = pts.map((p) => [p[0] * k1, p[1] * k1]);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const centered = pts.map((p) => [p[0] - cx, p[1] - cz] as V2);
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const worldSize = extent + 2 * MARGIN;

  const amp = Math.min(12, Math.max(3, L * 0.008)) * (opts.elevAmpScale ?? 1);
  const ys = elevationProfile(centered.length, amp, rng, opts.elevHillBias ?? 0);
  cohereElevation(centered, ys);
  relaxGrade(centered, ys, opts.gradeMax ?? MAIN_GRADE_MAX);
  const floor = opts.elevationFloor;
  if (floor !== undefined) {
    for (let i = 0; i < ys.length; i++) {
      if (ys[i]! < floor) ys[i] = floor;
    }
  }

  const control: Array<readonly [number, number, number]> = centered.map((p, i) => [
    p[0],
    ys[i] ?? 0,
    p[1],
  ]);

  return { control, worldSize, length: L };
}
