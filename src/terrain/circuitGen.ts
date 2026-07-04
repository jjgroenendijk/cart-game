import { CatmullRomCurve3, Vector3 } from "three";
import type { RNG } from "../core/rng";

export interface CircuitPlan {
  control: ReadonlyArray<readonly [number, number, number]>;
  worldSize: number;
  length: number;
}

export interface MainlineOpts {
  dispAmpRange?: readonly [number, number];
  elongRange?: readonly [number, number];
}

const MARGIN = 30;
const CTRL_SEP = 45;
const RELAX_ARC_GAP = 60;
const TWO_PI = Math.PI * 2;
const LENGTH_DIV = 512;

type V2 = [number, number];

function cross2(o: V2, a: V2, b: V2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: ReadonlyArray<V2>): V2[] {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const n = pts.length;
  if (n < 3) return pts.slice();
  // Pop the last stacked point while (prev, last, p) is a non-left (clockwise)
  // turn, i.e. the new point makes a left turn over the current hull edge.
  const nonLeft = (stk: V2[], p: V2): boolean => {
    if (stk.length < 2) return false;
    const a = stk[stk.length - 2]!;
    const b = stk[stk.length - 1]!;
    return cross2(a, b, p) <= 0;
  };
  const lower: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    while (nonLeft(lower, p)) lower.pop();
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (nonLeft(upper, p)) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Midpoint between consecutive points displaced along the edge perpendicular by
// a signed `frac` of that edge's length (frac scales with DISP_AMP, halved per
// round). Edge-proportional offset keeps the centripetal loop smooth; a fixed
// fraction of the full perimeter instead folds the track over itself.
function displaceOnce(pts: ReadonlyArray<V2>, frac: number, rng: RNG): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([a[0], a[1]]);
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const off = rng.unit() * frac * len;
    out.push([mx + nx * off, my + ny * off]);
  }
  return out;
}

// Drop control points closer than `minEdge` to the last kept point (cyclic) so
// consecutive spans stay roughly even. The centripetal Catmull-Rom kinks when a
// 1 m span sits next to a 6 m span (jitter-clustered hull vertices); collapsing
// the short spans restores a smooth radius of curvature without reshaping the
// loop.
function enforceMinEdge(pts: ReadonlyArray<V2>, minEdge: number): V2[] {
  const n = pts.length;
  if (n <= 4) return pts.map((p) => [p[0], p[1]] as V2);
  const out: V2[] = [[pts[0]![0], pts[0]![1]]];
  let lastX = pts[0]![0];
  let lastY = pts[0]![1];
  for (let i = 1; i < n; i++) {
    const p = pts[i]!;
    if (Math.hypot(p[0] - lastX, p[1] - lastY) >= minEdge) {
      out.push([p[0], p[1]]);
      lastX = p[0];
      lastY = p[1];
    }
  }
  if (out.length > 4) {
    const f = out[0]!;
    const l = out[out.length - 1]!;
    if (Math.hypot(l[0] - f[0], l[1] - f[1]) < minEdge) out.pop();
  }
  return out;
}

// Push-apart for far-arc folds: control pairs whose cyclic index gap >= gapIdx
// (an arc distance of ~ARC_GAP metres) and XZ dist < minSep get shoved apart
// along their connecting axis. The arc-based gap keeps it from crumpling dense
// neighbourhoods (a fixed gap>=3 only matches ~60 m at ~30 control points).
function relax(pts: ReadonlyArray<V2>, iters: number, minSep: number, gapIdx: number): V2[] {
  const out = pts.map((p) => [p[0], p[1]] as V2);
  const n = out.length;
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const gap = Math.min(j - i, n - (j - i));
        if (gap < gapIdx) continue;
        const a = out[i]!;
        const b = out[j]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const d = Math.hypot(dx, dy);
        if (d >= minSep || d < 1e-9) continue;
        const push = (minSep - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a[0] -= ux * push;
        a[1] -= uy * push;
        b[0] += ux * push;
        b[1] += uy * push;
      }
    }
  }
  return out;
}

function curveLengthXZ(pts: ReadonlyArray<V2>): number {
  const v = pts.map((p) => new Vector3(p[0], 0, p[1]));
  const c = new CatmullRomCurve3(v, true, "centripetal");
  c.arcLengthDivisions = LENGTH_DIV;
  return c.getLength();
}

// Laplacian smoothing: nudge each point a `factor` toward the midpoint of its
// cyclic neighbours. A few iterations open sharp corners (clustered hull
// vertices, opposing midpoint displacements) so the centripetal Catmull-Rom
// keeps a radius of curvature above the drivability floor, while the overall
// loop shape (elongation, gentle displacement bumps) is preserved.
function smoothLoop(pts: ReadonlyArray<V2>, iters: number, factor: number): V2[] {
  let out = pts.map((p) => [p[0], p[1]] as V2);
  const n = out.length;
  for (let it = 0; it < iters; it++) {
    const next = out.map((p) => [p[0], p[1]] as V2);
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n]!;
      const b = out[(i + 1) % n]!;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      next[i]![0] = out[i]![0] + (mx - out[i]![0]) * factor;
      next[i]![1] = out[i]![1] + (my - out[i]![1]) * factor;
    }
    out = next;
  }
  return out;
}

function elevationProfile(n: number, amp: number, rng: RNG): number[] {
  const fA = rng.range(0.5, 1.5);
  const pA = rng.range(0, TWO_PI);
  const fB = rng.range(1.0, 2.5);
  const pB = rng.range(0, TWO_PI);
  const ys: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const v = (Math.sin(TWO_PI * fA * u + pA) + 0.5 * Math.sin(TWO_PI * fB * u + pB)) / 1.5;
    ys[i] = amp * v;
  }
  return ys;
}

/**
 * Pure seeded mainline construction: scatter -> hull -> displace x2 ->
 * length-normalize -> enforceMinEdge -> relax -> smooth -> elevation. All
 * randomness flows from `rng`; same rng -> same plan. `worldSize` = max XZ bbox
 * extent + 2*MARGIN (caller shrinks+retries above WORLD_CAP). `length` is the
 * target L; the realized curve length is measured by the validator in
 * circuit.ts.
 */
export function buildMainline(rng: RNG, opts: MainlineOpts = {}): CircuitPlan {
  const [dLo, dHi] = opts.dispAmpRange ?? [0.05, 0.13];
  const [eLo, eHi] = opts.elongRange ?? [0.7, 1.3];
  const L = rng.range(600, 1500);
  const M = Math.floor(rng.range(18, 31));
  const dispAmp = rng.range(dLo, dHi);
  const elongA = rng.range(eLo, eHi);
  const elongB = rng.range(eLo, eHi);
  const base = L / TWO_PI;

  const scatter: V2[] = new Array(M);
  for (let i = 0; i < M; i++) {
    const theta = (i / M) * TWO_PI + rng.unit() * (Math.PI / M);
    // Points on the ellipse boundary (r=1) so the hull captures ~all of them:
    // many hull vertices -> gentle corner angles -> the centripetal Catmull-Rom
    // keeps a large radius of curvature. Interior scatter yields only ~8 hull
    // points whose sharp corners spike the radius below the 12.5 m floor.
    scatter[i] = [base * elongA * Math.cos(theta), base * elongB * Math.sin(theta)];
  }

  let hull = convexHull(scatter);
  if (hull.length < 4) {
    hull = scatter
      .map((p) => ({ p, a: Math.atan2(p[1], p[0]) }))
      .sort((x, y) => x.a - y.a)
      .map((x) => x.p);
  }

  let pts: V2[] = hull.map((p) => [p[0], p[1]]);
  pts = displaceOnce(pts, dispAmp, rng);
  pts = displaceOnce(pts, dispAmp / 2, rng);

  // Length-normalize before relaxing so the push-apart thresholds (CTRL_SEP,
  // the ~60 m arc gap) are evaluated in final metres, not raw hull units.
  const len0 = curveLengthXZ(pts);
  const s = L / len0;
  const scaled = pts.map((p) => [p[0] * s, p[1] * s] as V2);

  const minEdge = (L / scaled.length) * 0.4;
  const evened = enforceMinEdge(scaled, minEdge);

  const gapIdx = Math.max(3, Math.ceil((RELAX_ARC_GAP * evened.length) / L));
  const relaxed = relax(evened, 4, CTRL_SEP, gapIdx);
  const smoothed = smoothLoop(relaxed, 5, 0.4);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of smoothed) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const centered = smoothed.map((p) => [p[0] - cx, p[1] - cz] as V2);
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const worldSize = extent + 2 * MARGIN;

  const amp = Math.min(6, Math.max(2, L * 0.004));
  const ys = elevationProfile(centered.length, amp, rng);

  const control: Array<readonly [number, number, number]> = centered.map((p, i) => [
    p[0],
    ys[i] ?? 0,
    p[1],
  ]);

  return { control, worldSize, length: L };
}
