import { CatmullRomCurve3, Vector3 } from "three";
import type { RNG } from "../core/rng";

export interface CircuitPlan {
  control: ReadonlyArray<readonly [number, number, number]>;
  worldSize: number;
  length: number;
}

export interface MainlineOpts {
  elongRange?: readonly [number, number];
  // Amplitude of the low-frequency radial profile (fraction of base radius).
  // Two slow sine lobes at this depth dip whole arcs of the loop inward ->
  // broad, deep concavities (kidney/peanut/hook) like a real circuit. A convex
  // hull can never produce these. generateCircuit relaxes this toward ~0.12 on
  // retry so seeds whose concavities self-fold converge to gentler shapes.
  depthRange?: readonly [number, number];
}

const MARGIN = 30;
const RELAX_SEP = 34;
const RELAX_ARC_GAP = 60;
const TWO_PI = Math.PI * 2;
const LENGTH_DIV = 512;

type V2 = [number, number];

// Drop control points closer than `minEdge` to the last kept point (cyclic) so
// consecutive spans stay roughly even. The centripetal Catmull-Rom kinks when a
// 1 m span sits next to a 6 m span; collapsing the short spans restores a smooth
// radius of curvature without reshaping the loop.
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
// (an arc distance of ~ARC_GAP metres) and XZ dist < minSep get shoved apart.
// Gentle (2 iters, target just above the SEP_MIN validator floor) so it only
// opens genuine near-touches without flattening the broad concavities.
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
 * Pure seeded mainline construction: a star-shaped loop whose polar radius is a
 * low-frequency profile (two sine lobes), then length-normalize ->
 * enforceMinEdge -> gentle relax -> elevation. The shape comes ENTIRELY from the
 * radial profile: a1 dips a whole arc of the loop inward (one broad kidney/hook
 * concavity), a2 adds a second smaller one (peanut). No convex hull (it would
 * erase the concavities), no midpoint displacement and no per-point jitter (high-
 * frequency noise kinks the centripetal spline at the deep transitions, failing
 * the minRadius validator -> the seed retries shallow -> boring). f1 is weighted
 * to a single cycle: one broad inward arc has high indent yet, being alone, can
 * never approach another inward arc, so it rarely trips the separation gate.
 * Ordering by polar angle yields a single non-self-intersecting loop. All
 * randomness flows from `rng`; same rng -> same plan. `worldSize` = max XZ bbox
 * extent + 2*MARGIN; `length` is the target L (realized length measured by the
 * validator in circuit.ts).
 */
export function buildMainline(rng: RNG, opts: MainlineOpts = {}): CircuitPlan {
  const [eLo, eHi] = opts.elongRange ?? [0.85, 1.2];
  const [depthLo, depthHi] = opts.depthRange ?? [0.28, 0.46];
  const L = rng.range(660, 1500);
  const M = Math.floor(rng.range(28, 40));
  const base = L / TWO_PI;
  const elongA = rng.range(eLo, eHi);
  const elongB = rng.range(eLo, eHi);

  const rCenter = rng.range(0.62, 0.78);
  const depth = rng.range(depthLo, depthHi);
  const f1 = rng.pick([1, 1, 1, 1, 2]);
  const f2 = rng.pick([2, 3, 4]);
  const p1 = rng.range(0, TWO_PI);
  const p2 = rng.range(0, TWO_PI);
  const a1 = depth;
  const a2 = depth * rng.range(0.3, 0.5);
  const rFloor = 0.2;

  const scatter: V2[] = new Array(M);
  for (let i = 0; i < M; i++) {
    const theta = (i / M) * TWO_PI + rng.unit() * (Math.PI / M);
    let r = rCenter + a1 * Math.sin(f1 * theta + p1) + a2 * Math.sin(f2 * theta + p2);
    if (r < rFloor) r = rFloor;
    scatter[i] = [base * elongA * r * Math.cos(theta), base * elongB * r * Math.sin(theta)];
  }
  const pts: V2[] = scatter
    .map((p) => ({ p, a: Math.atan2(p[1], p[0]) }))
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p);

  // Length-normalize before relaxing so the push-apart threshold (RELAX_SEP,
  // the ~60 m arc gap) is evaluated in final metres, not raw units.
  const len0 = curveLengthXZ(pts);
  const s = L / len0;
  const scaled = pts.map((p) => [p[0] * s, p[1] * s] as V2);

  const minEdge = (L / scaled.length) * 0.4;
  const evened = enforceMinEdge(scaled, minEdge);

  const gapIdx = Math.max(3, Math.ceil((RELAX_ARC_GAP * evened.length) / L));
  const relaxed = relax(evened, 2, RELAX_SEP, gapIdx);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of relaxed) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const centered = relaxed.map((p) => [p[0] - cx, p[1] - cz] as V2);
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
