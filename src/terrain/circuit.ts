import { CatmullRomCurve3, Vector3 } from "three";
import { makeRNG } from "../core/rng";
import { SampleIndex, type WidthProfile } from "./trackGraph";
import { buildMainline, type CircuitPlan, type MainlineOpts } from "./circuitGen";
import { generateWidthProfile } from "./circuitWidth";
import { generateBranches, type BranchSpec } from "./circuitBranch";
import { DEFAULT_TRACK_TRAITS, type TrackTraits } from "./trackTraits";

export interface GeneratedCircuit {
  control: ReadonlyArray<readonly [number, number, number]>;
  worldSize: number;
  length: number;
  /** Per-station corridor half-width along the mainline (059). */
  mainWidth: WidthProfile;
  /** Validated split/rejoin branches; empty when none placed (060). */
  branches: ReadonlyArray<BranchSpec>;
}

/**
 * Validity + shape read of one circuit. Validity gates acceptance; the shape
 * metrics quantify "interesting" (the sweep test asserts distribution floors
 * so the generator can never quietly regress to ovals again).
 */
export interface CircuitAnalysis {
  ok: boolean;
  length: number;
  minRadius: number;
  /** Min XZ distance over sample pairs 60-140 m apart in arc (hairpin legs). */
  sepNear: number;
  /** Min XZ distance over sample pairs > 140 m apart in arc. */
  sepFar: number;
  selfIntersect: boolean;
  /** Corners: contiguous turn runs accumulating >= 25 deg. */
  cornerCount: number;
  /** Corners turning >= 100 deg with an apex radius <= 26 m. */
  hairpins: number;
  /** Direction alternations between consecutive corners < 110 m apart. */
  sBends: number;
  /** Longest run with turn radius > 150 m (metres). */
  longestStraight: number;
}

const MIN_RADIUS = 12.5;
const ACCEPT_RADIUS = 13;
// Two-tier separation floors (relax targets in circuitGen sit above these):
// near pairs are hairpin legs (roads may sit close; elevation coherence keeps
// them level); far pairs are unrelated sections that would tear the field
// cache if closer than the corridor + blend footprint on both sides.
const SEP_NEAR_MIN = 18;
const SEP_FAR_MIN = 30;
const NEAR_ARC_GAP = 60;
const FAR_ARC_GAP = 140;
const WORLD_CAP = 768;
const MARGIN = 30;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const MAX_ATTEMPTS = 12;
const LENGTH_DIV = 512;
// Corner segmentation thresholds on the ~3 m-spaced samples.
const CORNER_RADIUS = 60;
const STRAIGHT_RADIUS = 150;
const CORNER_MIN_TURN = (25 * Math.PI) / 180;
const HAIRPIN_TURN = (100 * Math.PI) / 180;
const HAIRPIN_APEX_RADIUS = 30;
const S_BEND_GAP = 110;
/**
 * Fallback seed: runs the normal pipeline with untamed options and is
 * test-asserted to validate on that exact draw (attempt 0), so every seed
 * terminates with a valid, still-interesting loop even if all attempts fail.
 * Seed 1 attempt 0: 944 m, minRadius 20.9, 8 corners, 1 hairpin, 2 esses.
 */
export const FALLBACK_SEED = 1;

interface Samples {
  x: Float32Array;
  z: Float32Array;
  n: number;
  length: number;
  /** Uniform arc spacing between consecutive samples (metres). */
  ds: number;
}

/** Arc-length-even XZ samples (~3 m spacing, clamped 224..512 samples). */
function sampleCurve(control: ReadonlyArray<readonly [number, number, number]>): Samples {
  const pts = control.map((c) => new Vector3(c[0], c[1], c[2]));
  const curve = new CatmullRomCurve3(pts, true, "centripetal");
  curve.arcLengthDivisions = LENGTH_DIV;
  const length = curve.getLength();
  const count = Math.min(512, Math.max(224, Math.round(length / 3)));
  const sp = curve.getSpacedPoints(count).slice(0, count);
  const n = sp.length;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = sp[i]!.x;
    z[i] = sp[i]!.z;
  }
  return { x, z, n, length, ds: length / n };
}

/**
 * Signed turn angle at each sample (rad; + = left in XZ) plus the min Menger
 * circumradius. One pass feeds both validity (radius floor) and the corner
 * metrics.
 */
function turnAngles(s: Samples): { theta: Float32Array; minRadius: number } {
  const { x, z, n } = s;
  const theta = new Float32Array(n);
  let minR = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = x[(i - 1 + n) % n]!;
    const az = z[(i - 1 + n) % n]!;
    const bx = x[i]!;
    const bz = z[i]!;
    const cx = x[(i + 1) % n]!;
    const cz = z[(i + 1) % n]!;
    const ux = bx - ax;
    const uz = bz - az;
    const vx = cx - bx;
    const vz = cz - bz;
    const cross = ux * vz - uz * vx;
    const dot = ux * vx + uz * vz;
    theta[i] = Math.atan2(cross, dot);
    const dab = Math.hypot(ux, uz);
    const dbc = Math.hypot(vx, vz);
    const dca = Math.hypot(ax - cx, az - cz);
    if (dab < 1e-9 || dbc < 1e-9 || dca < 1e-9) continue;
    const area2 = Math.abs(cross);
    if (area2 < 1e-9) continue;
    const R = (dab * dbc * dca) / (2 * area2);
    if (R < minR) minR = R;
  }
  return { theta, minRadius: minR };
}

interface CornerMetrics {
  cornerCount: number;
  hairpins: number;
  sBends: number;
  longestStraight: number;
}

/**
 * Segment the loop into corners (runs of |turn| above the CORNER_RADIUS rate,
 * tolerating <= 2 slack samples) and straights. A corner counts at >= 25 deg
 * total turn; hairpins additionally need >= 100 deg and a tight apex.
 */
function cornerMetrics(s: Samples, theta: Float32Array): CornerMetrics {
  const { n, ds } = s;
  const cornerThresh = ds / CORNER_RADIUS;
  const straightThresh = ds / STRAIGHT_RADIUS;

  interface Corner {
    turn: number;
    apexR: number;
    center: number;
  }
  const corners: Corner[] = [];
  // Start scanning at a non-corner sample so no corner straddles the seam
  // (worst case: everything is a corner -> start anywhere).
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(theta[i]!) <= cornerThresh) {
      start = i;
      break;
    }
  }
  let turn = 0;
  let maxAbs = 0;
  let first = -1;
  let last = -1;
  let slack = 0;
  const flush = (): void => {
    if (first >= 0 && Math.abs(turn) >= CORNER_MIN_TURN && maxAbs > 0) {
      corners.push({ turn, apexR: ds / maxAbs, center: ((first + last) / 2) % n });
    }
    turn = 0;
    maxAbs = 0;
    first = -1;
    last = -1;
    slack = 0;
  };
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const th = theta[i]!;
    const inCorner = Math.abs(th) > cornerThresh;
    // Sign flip inside a run splits it: an S is two corners, not one.
    if (inCorner && first >= 0 && Math.sign(th) !== Math.sign(turn) && turn !== 0) flush();
    if (inCorner) {
      if (first < 0) first = k;
      last = k;
      turn += th;
      if (Math.abs(th) > maxAbs) maxAbs = Math.abs(th);
      slack = 0;
    } else if (first >= 0 && ++slack > 2) {
      flush();
    }
  }
  flush();

  let hairpins = 0;
  for (const c of corners) {
    if (Math.abs(c.turn) >= HAIRPIN_TURN && c.apexR <= HAIRPIN_APEX_RADIUS) hairpins++;
  }

  let sBends = 0;
  const m = corners.length;
  for (let i = 0; i < m && m >= 2; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % m]!;
    const rawGap = Math.abs(b.center - a.center) * ds;
    const gap = Math.min(rawGap, s.length - rawGap);
    if (Math.sign(a.turn) !== Math.sign(b.turn) && gap <= S_BEND_GAP) sBends++;
  }

  let longestStraight = 0;
  let run = 0;
  // Two passes over the ring bound the wrap-around straight.
  for (let k = 0; k < 2 * n; k++) {
    if (Math.abs(theta[k % n]!) < straightThresh) {
      run++;
      if (run > longestStraight) longestStraight = run;
      if (run >= 2 * n) break;
    } else {
      run = 0;
    }
  }
  return {
    cornerCount: corners.length,
    hairpins,
    sBends,
    longestStraight: Math.min(longestStraight, n) * ds,
  };
}

function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function segCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const d1 = orient(cx, cz, dx, dz, ax, az);
  const d2 = orient(cx, cz, dx, dz, bx, bz);
  const d3 = orient(ax, az, bx, bz, cx, cz);
  const d4 = orient(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

interface SeparationRead {
  sepNear: number;
  sepFar: number;
  selfIntersect: boolean;
}

/**
 * Tiered min separation + self-intersection in one bucket-accelerated pass.
 * Separation reads sample pairs (radius query at the SEP_FAR floor);
 * intersection tests segments whose endpoints fall within ~2 sample spacings
 * of a segment midpoint (any crossing pair must).
 */
function separationAndCrossing(s: Samples): SeparationRead {
  const { x, z, n, ds, length } = s;
  const idx = new SampleIndex(x, z, 16);
  let sepNear = Infinity;
  let sepFar = Infinity;
  let selfIntersect = false;
  const crossR = 2 * ds;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const zi = z[i]!;
    idx.forEachWithin(xi, zi, SEP_FAR_MIN, (j, dSq) => {
      if (j <= i) return;
      const rawGap = (j - i) * ds;
      const gap = Math.min(rawGap, length - rawGap);
      if (gap <= NEAR_ARC_GAP) return;
      const d = Math.sqrt(dSq);
      if (gap > FAR_ARC_GAP) {
        if (d < sepFar) sepFar = d;
      } else if (d < sepNear) {
        sepNear = d;
      }
    });
    if (selfIntersect) continue;
    const i1 = (i + 1) % n;
    const mx = (xi + x[i1]!) / 2;
    const mz = (zi + z[i1]!) / 2;
    idx.forEachWithin(mx, mz, crossR, (j) => {
      if (selfIntersect) return;
      const gapIdx = Math.min(Math.abs(j - i), n - Math.abs(j - i));
      if (gapIdx <= 1) return;
      const j1 = (j + 1) % n;
      const gap1 = Math.min(Math.abs(j1 - i), n - Math.abs(j1 - i));
      if (gap1 < 1) return;
      if (segCross(xi, zi, x[i1]!, z[i1]!, x[j]!, z[j]!, x[j1]!, z[j1]!)) selfIntersect = true;
    });
  }
  return { sepNear, sepFar, selfIntersect };
}

/** Full validity + shape analysis of a control loop (pure, deterministic). */
export function validateCircuit(
  control: ReadonlyArray<readonly [number, number, number]>,
): CircuitAnalysis {
  const s = sampleCurve(control);
  const { theta, minRadius } = turnAngles(s);
  const sep = separationAndCrossing(s);
  const corners = cornerMetrics(s, theta);
  const ok =
    minRadius >= MIN_RADIUS &&
    !sep.selfIntersect &&
    sep.sepNear >= SEP_NEAR_MIN &&
    sep.sepFar >= SEP_FAR_MIN;
  return {
    ok,
    length: s.length,
    minRadius,
    sepNear: sep.sepNear,
    sepFar: sep.sepFar,
    selfIntersect: sep.selfIntersect,
    ...corners,
  };
}

function scalePlanXZ(plan: CircuitPlan, k: number): CircuitPlan {
  const control: Array<readonly [number, number, number]> = plan.control.map((c) => [
    c[0] * k,
    c[1],
    c[2] * k,
  ]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of control) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[2] < minZ) minZ = c[2];
    if (c[2] > maxZ) maxZ = c[2];
  }
  const extent = Math.max(maxX - minX, maxZ - minZ);
  return { control, worldSize: extent + 2 * MARGIN, length: plan.length * k };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Attempt-t taming: shapes get rounder/gentler as attempts mount. */
export function tamedOpts(t: number): MainlineOpts {
  return {
    dispAmpRange: [lerp(0.05, 0.03, t), lerp(0.13, 0.06, t)],
    elongRange: [1.0, lerp(1.45, 1.15, t)],
    featureScale: lerp(1, 0.4, t),
    maxFolds: t < 0.5 ? 3 : t < 0.8 ? 2 : 1,
    smoothFactor: lerp(0.18, 0.34, t),
  };
}

/** One deterministic attempt draw (exported for the fallback-validity test). */
export function buildAttempt(seedU: number, attempt: number, opts: MainlineOpts): CircuitPlan {
  const subSeed = (Math.imul(seedU ^ 0x9e3779b1, 0x85ebca77) + attempt * 0xc2b2ae35) >>> 0;
  let plan = buildMainline(makeRNG(subSeed), opts);
  if (plan.worldSize > WORLD_CAP) {
    plan = scalePlanXZ(plan, (WORLD_CAP - 1) / plan.worldSize);
  }
  return plan;
}

/**
 * Seed -> drivable single closed loop with real shape variety (hairpin bays,
 * chicanes, S-bends, straights). Each attempt draws a fresh mainline from a
 * deterministic sub-RNG; feature depth, displacement, and elongation tame as
 * attempts mount. If every attempt fails, the FALLBACK_SEED mainline (test-
 * asserted valid) is returned, so every seed terminates with a valid loop.
 * `traits` (059, biome track character) drives the width profile; the width
 * draw is independent of the attempt loop so taming never changes the width
 * character of a seed.
 */
export function generateCircuit(
  seed: number,
  traits: TrackTraits = DEFAULT_TRACK_TRAITS,
): GeneratedCircuit {
  const seedU = seed >>> 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const t = attempt / (MAX_ATTEMPTS - 1);
    const plan = buildAttempt(seedU, attempt, tamedOpts(t));
    const v = validateCircuit(plan.control);
    const valid =
      v.ok && v.minRadius >= ACCEPT_RADIUS && v.length >= LEN_MIN && v.length <= LEN_MAX;
    // Early attempts must also be interesting (a hairpin, an ess sequence,
    // or a corner-rich flow); only late attempts accept a plain valid loop.
    // This is the anti-oval gate: featureless blobs get redrawn, not shipped.
    const interesting = v.hairpins >= 1 || v.sBends >= 2 || v.cornerCount >= 7;
    if (valid && (interesting || attempt >= 8)) {
      return finishCircuit(seedU, plan, v.length, traits);
    }
  }
  const plan = buildAttempt(FALLBACK_SEED, 0, tamedOpts(0));
  const v = validateCircuit(plan.control);
  return finishCircuit(seedU, plan, v.length, traits);
}

/**
 * Attach the seed-derived width profile + branches to an accepted plan and
 * grow worldSize to cover scenic bows that leave the mainline bbox.
 */
function finishCircuit(
  seedU: number,
  plan: CircuitPlan,
  length: number,
  traits: TrackTraits,
): GeneratedCircuit {
  const branches = generateBranches(seedU, plan.control, traits);
  let worldSize = plan.worldSize;
  for (const b of branches) {
    for (const p of b.points) {
      const extent = 2 * Math.max(Math.abs(p[0]), Math.abs(p[2])) + 2 * MARGIN;
      if (extent > worldSize) worldSize = extent;
    }
  }
  return {
    control: plan.control,
    worldSize,
    length,
    mainWidth: generateWidthProfile(seedU, length, traits),
    branches,
  };
}
