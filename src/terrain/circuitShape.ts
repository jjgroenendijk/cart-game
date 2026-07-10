import { CatmullRomCurve3, Vector3 } from "three";
import type { RNG } from "../core/rng";

/**
 * Pure 2D polygon/arc primitives for the circuit generator (057). Everything
 * operates on closed CCW loops of [x, z] points in metres; circuitGen.ts owns
 * the pipeline (scatter -> hull -> fillet -> carve -> displace -> relax) and
 * this module owns the geometry it is built from.
 */

export type V2 = [number, number];

const LENGTH_DIV = 512;

// Two-tier push-apart targets, sitting above the circuit.ts validation floors
// (18 m near / 30 m far) so relax leaves margin for smoothing + length trim.
// Near tier (arc gap 60-140 m) is deliberately tight: hairpin legs sit
// ~34-46 m apart and MUST survive relaxation, else every fold opens back
// into an oval.
const NEAR_ARC_GAP = 60;
const FAR_ARC_GAP = 140;
const SEP_NEAR_TARGET = 20;
const SEP_FAR_TARGET = 34;

// Straight spans above MAX_SEG get subdivided so displacement has material to
// wiggle; spans below MIN_EDGE (jitter-clustered hull vertices) collapse
// BEFORE carving so the pass cannot eat deliberately close arc points later.
export const MAX_SEG = 42;
export const MIN_EDGE = 16;
const DISPLACE_MIN_SEG = 30;

// Corner fillets: every polygon corner is replaced by a sampled circular arc
// whose radius is drawn per-corner (hard 16-24, medium 26-42, sweeper 46-75)
// and capped by the available arm length. The arc pins the driving radius by
// construction; a bare Catmull-Rom through a sharp hull vertex kinks far
// below the 12.5 m drivability floor.
const FILLET_R_FLOOR = 13;
const FILLET_MIN_TURN = 0.15;
const FILLET_ARM_BUDGET = 0.42;

function cross2(o: V2, a: V2, b: V2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function convexHull(points: ReadonlyArray<V2>): V2[] {
  const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const n = pts.length;
  if (n < 3) return pts.slice();
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

/** Shoelace signed area; > 0 means CCW in the (x, z) plane. */
export function signedArea(pts: ReadonlyArray<V2>): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function perimeter(pts: ReadonlyArray<V2>): number {
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    sum += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return sum;
}

/** Cumulative chord arc to each vertex (prefix[i] = arc from vertex 0 to i). */
export function prefixArc(pts: ReadonlyArray<V2>): { prefix: Float64Array; total: number } {
  const n = pts.length;
  const prefix = new Float64Array(n);
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const p = pts[i - 1]!;
    const q = pts[i]!;
    sum += Math.hypot(q[0] - p[0], q[1] - p[1]);
    prefix[i] = sum;
  }
  const last = pts[n - 1]!;
  const first = pts[0]!;
  const total = sum + Math.hypot(first[0] - last[0], first[1] - last[1]);
  return { prefix, total };
}

/** Signed exterior turn at vertex i (rad; + = left/CCW). */
export function turnAt(pts: ReadonlyArray<V2>, i: number): number {
  const n = pts.length;
  const p = pts[(i - 1 + n) % n]!;
  const v = pts[i]!;
  const q = pts[(i + 1) % n]!;
  const ux = v[0] - p[0];
  const uy = v[1] - p[1];
  const wx = q[0] - v[0];
  const wy = q[1] - v[1];
  return Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy);
}

/** Sampled circular arc: angles a0..a0+sweep around (cx, cy), step <= ~26 m. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): V2[] {
  const maxStep = Math.min(0.5, 26 / r);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
  const out: V2[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (sweep * k) / steps;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * Remove vertices whose corner is too sharp to fillet at the radius floor
 * given its arm budget (a spike between two long edges). At most 3 passes;
 * each removal lengthens the neighbours' arms.
 */
export function dropSpikes(pts: V2[]): V2[] {
  const out = pts.slice();
  for (let pass = 0; pass < 3; pass++) {
    const n = out.length;
    if (n < 5) break;
    let worst = -1;
    let worstTurn = 0;
    for (let i = 0; i < n; i++) {
      const theta = Math.abs(turnAt(out, i));
      if (theta < 1.2) continue;
      const p = out[(i - 1 + n) % n]!;
      const v = out[i]!;
      const q = out[(i + 1) % n]!;
      const armIn = Math.hypot(v[0] - p[0], v[1] - p[1]);
      const armOut = Math.hypot(q[0] - v[0], q[1] - v[1]);
      const tMax = FILLET_ARM_BUDGET * Math.min(armIn, armOut);
      if (tMax / Math.tan(theta / 2) < FILLET_R_FLOOR && theta > worstTurn) {
        worst = i;
        worstTurn = theta;
      }
    }
    if (worst < 0) break;
    out.splice(worst, 1);
  }
  return out;
}

/** Relative tier weights for the per-corner radius draw (archetype knob). */
export interface CornerMix {
  /** Hard corners, radius 16-24 m. */
  hard: number;
  /** Medium corners, radius 26-42 m. */
  medium: number;
  /** Sweepers, radius 46-75 m. */
  sweeper: number;
}

/** The pre-archetype mix: 35% hard / 40% medium / 25% sweeper. */
export const DEFAULT_CORNER_MIX: CornerMix = { hard: 0.35, medium: 0.4, sweeper: 0.25 };

/**
 * Per-corner fillet radius: the hard / medium / sweeper mix drives corner
 * feel. Always exactly two rng draws (tier roll + radius) regardless of the
 * tier chosen, so different mixes stay draw-aligned.
 */
function drawFilletRadius(rng: RNG, mix: CornerMix): number {
  const total = mix.hard + mix.medium + mix.sweeper;
  const roll = rng.next() * total;
  if (roll < mix.hard) return rng.range(16, 24);
  if (roll < mix.hard + mix.medium) return rng.range(26, 42);
  return rng.range(46, 75);
}

/**
 * Replace every corner turning more than FILLET_MIN_TURN with a sampled
 * tangent arc. The radius draw (capped by arm length) is what creates the
 * hard/soft corner mix; the arc sampling guarantees the curve actually
 * follows that radius.
 */
export function filletCorners(
  pts: ReadonlyArray<V2>,
  rng: RNG,
  mix: CornerMix = DEFAULT_CORNER_MIX,
): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n]!;
    const v = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const inX = v[0] - p[0];
    const inY = v[1] - p[1];
    const outX = q[0] - v[0];
    const outY = q[1] - v[1];
    const armIn = Math.hypot(inX, inY);
    const armOut = Math.hypot(outX, outY);
    const theta = turnAt(pts, i);
    const absTh = Math.abs(theta);
    // The radius draw always runs so taming retries stay draw-aligned.
    const drawn = drawFilletRadius(rng, mix);
    if (absTh < FILLET_MIN_TURN || armIn < 1e-6 || armOut < 1e-6) {
      out.push([v[0], v[1]]);
      continue;
    }
    const tanHalf = Math.tan(absTh / 2);
    // Arm budget is capped both relatively and absolutely (36 m): without
    // the absolute cap a sweeper radius on a sharp corner consumes the whole
    // straight, leaving no host edges for folds/chicanes.
    const tMax = Math.min(FILLET_ARM_BUDGET * Math.min(armIn, armOut), 36);
    const r = Math.min(drawn, tMax / tanHalf);
    if (r < FILLET_R_FLOOR) {
      out.push([v[0], v[1]]);
      continue;
    }
    const t = r * tanHalf;
    const u1x = inX / armIn;
    const u1y = inY / armIn;
    const side = Math.sign(theta);
    // Tangent point on the incoming arm; center sits r to the turn side
    // (rot90(u1, side) = (-side*u1y, side*u1x)). Sweeping the position angle
    // by theta lands exactly on the outgoing arm's tangent point.
    const t1x = v[0] - u1x * t;
    const t1y = v[1] - u1y * t;
    const cx = t1x - side * u1y * r;
    const cy = t1y + side * u1x * r;
    const a0 = Math.atan2(t1y - cy, t1x - cx);
    for (const ap of arcPoints(cx, cy, r, a0, theta)) out.push(ap);
  }
  return out;
}

/**
 * Min positive distance from `origin` along unit `dir` to any polygon edge not
 * touching vertex indices in `skip`. Bounds hairpin fold depth so a bay never
 * punches through the far side of the loop.
 */
export function rayClearance(
  pts: ReadonlyArray<V2>,
  origin: V2,
  dir: V2,
  skip: ReadonlySet<number>,
): number {
  const n = pts.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (skip.has(i) || skip.has(j)) continue;
    const p = pts[i]!;
    const q = pts[j]!;
    const sx = q[0] - p[0];
    const sy = q[1] - p[1];
    const denom = dir[0] * sy - dir[1] * sx;
    if (Math.abs(denom) < 1e-9) continue;
    const px = p[0] - origin[0];
    const py = p[1] - origin[1];
    const t = (px * sy - py * sx) / denom;
    const u = (px * dir[1] - py * dir[0]) / -denom;
    if (t > 1 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** Insert evenly spaced points on every span longer than maxSeg. */
export function subdivideLong(pts: ReadonlyArray<V2>, maxSeg: number): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([a[0], a[1]]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const pieces = Math.ceil(len / maxSeg);
    for (let k = 1; k < pieces; k++) {
      const f = k / pieces;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

// Drop control points closer than `minEdge` to the last kept point (cyclic) so
// consecutive spans stay roughly even; short spans kink the centripetal curve.
export function enforceMinEdge(pts: ReadonlyArray<V2>, minEdge: number): V2[] {
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

// Midpoint between consecutive points displaced along the edge perpendicular
// by a signed `frac` of that edge's length. The signed draw is what makes
// S-bends: adjacent midpoints flipping sides turn a straight into esses.
// Spans below DISPLACE_MIN_SEG (fillet/apex arc samples) are left alone.
export function displaceOnce(pts: ReadonlyArray<V2>, frac: number, rng: RNG): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([a[0], a[1]]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const off = rng.unit() * frac * len;
    if (len < DISPLACE_MIN_SEG) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    out.push([mx + nx * off, my + ny * off]);
  }
  return out;
}

/**
 * Two-tier push-apart keyed on true chord-arc gap: far-in-arc pairs (> 140 m)
 * are shoved to >= 34 m so unrelated sections never tear the field cache;
 * near pairs (60-140 m, i.e. hairpin legs) only to >= 20 m so folds survive.
 */
export function relaxTwoTier(pts: ReadonlyArray<V2>, iters: number): V2[] {
  const out = pts.map((p) => [p[0], p[1]] as V2);
  const n = out.length;
  for (let iter = 0; iter < iters; iter++) {
    const { prefix, total } = prefixArc(out);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const raw = prefix[j]! - prefix[i]!;
        const gap = Math.min(raw, total - raw);
        if (gap < NEAR_ARC_GAP) continue;
        const minSep = gap > FAR_ARC_GAP ? SEP_FAR_TARGET : SEP_NEAR_TARGET;
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

// Laplacian smoothing: nudge each point toward the midpoint of its cyclic
// neighbours. Two light iterations kill displacement kinks (arcs only get
// rounder); the taming loop raises the factor on retries.
export function smoothLoop(pts: ReadonlyArray<V2>, iters: number, factor: number): V2[] {
  let out = pts.map((p) => [p[0], p[1]] as V2);
  const n = out.length;
  for (let it = 0; it < iters; it++) {
    const next = out.map((p) => [p[0], p[1]] as V2);
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n]!;
      const b = out[(i + 1) % n]!;
      next[i]![0] = out[i]![0] + ((a[0] + b[0]) / 2 - out[i]![0]) * factor;
      next[i]![1] = out[i]![1] + ((a[1] + b[1]) / 2 - out[i]![1]) * factor;
    }
    out = next;
  }
  return out;
}

/** Closed centripetal Catmull-Rom XZ length of a control polygon. */
export function curveLengthXZ(pts: ReadonlyArray<V2>): number {
  const v = pts.map((p) => new Vector3(p[0], 0, p[1]));
  const c = new CatmullRomCurve3(v, true, "centripetal");
  c.arcLengthDivisions = LENGTH_DIV;
  return c.getLength();
}
