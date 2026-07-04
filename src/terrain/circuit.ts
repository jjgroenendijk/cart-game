import { CatmullRomCurve3, Vector3 } from "three";
import { makeRNG } from "../core/rng";
import { SampleIndex } from "./trackGraph";
import { buildMainline, type CircuitPlan } from "./circuitGen";

export interface GeneratedCircuit {
  control: ReadonlyArray<readonly [number, number, number]>;
  worldSize: number;
  length: number;
}

export interface ValidationResult {
  ok: boolean;
  length: number;
  minRadius: number;
  minSeparation: number;
  selfIntersect: boolean;
}

const MIN_RADIUS = 12.5;
const ACCEPT_RADIUS = 14;
const SEP_MIN = 30;
const ARC_GAP = 60;
const WORLD_CAP = 768;
const MARGIN = 30;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const MAX_ATTEMPTS = 12;
export const VALIDATE_SAMPLES = 256;
const TWO_PI = Math.PI * 2;
const LENGTH_DIV = 512;

interface Samples {
  x: Float32Array;
  z: Float32Array;
  n: number;
  length: number;
}

function sampleCurve(
  control: ReadonlyArray<readonly [number, number, number]>,
  count: number,
): Samples {
  const pts = control.map((c) => new Vector3(c[0], c[1], c[2]));
  const curve = new CatmullRomCurve3(pts, true, "centripetal");
  curve.arcLengthDivisions = LENGTH_DIV;
  const sp = curve.getSpacedPoints(count).slice(0, count);
  const n = sp.length;
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = sp[i]!.x;
    z[i] = sp[i]!.z;
  }
  return { x, z, n, length: curve.getLength() };
}

// Circumradius R of each consecutive sample triple via 2*area = |cross|, i.e.
// R = (dAB*dBC*dCA)/(2*|cross|). Computed in XZ (the driving turn radius).
function minRadiusXZ(s: Samples): number {
  let minR = Infinity;
  const { x, z, n } = s;
  for (let i = 0; i < n; i++) {
    const ax = x[(i - 1 + n) % n]!;
    const ay = z[(i - 1 + n) % n]!;
    const bx = x[i]!;
    const by = z[i]!;
    const cx = x[(i + 1) % n]!;
    const cy = z[(i + 1) % n]!;
    const dab = Math.hypot(bx - ax, by - ay);
    const dbc = Math.hypot(cx - bx, cy - by);
    const dca = Math.hypot(ax - cx, ay - cy);
    if (dab < 1e-9 || dbc < 1e-9 || dca < 1e-9) continue;
    const area2 = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    if (area2 < 1e-9) continue;
    const R = (dab * dbc * dca) / (2 * area2);
    if (R < minR) minR = R;
  }
  return minR;
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

function hasSelfIntersection(s: Samples): boolean {
  const { x, z, n } = s;
  for (let i = 0; i < n; i++) {
    const ax = x[i]!;
    const az = z[i]!;
    const bx = x[(i + 1) % n]!;
    const bz = z[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const cx = x[j]!;
      const cz = z[j]!;
      const dx = x[(j + 1) % n]!;
      const dz = z[(j + 1) % n]!;
      if (segCross(ax, az, bx, bz, cx, cz, dx, dz)) return true;
    }
  }
  return false;
}

// Min XZ separation between far-arc sample pairs (arc gap > ARC_GAP). The
// SampleIndex owns the coordinate storage; sampleDistSq reads it without
// re-deriving a bucket grid. Two sections closer than SEP_MIN tear the field
// cache, so this must pass before the circuit is accepted.
function minSeparation(s: Samples): number {
  const { x, z, n, length } = s;
  const idx = new SampleIndex(x, z, 16);
  const arcStep = length / n;
  const gapIdx = Math.max(1, Math.ceil(ARC_GAP / arcStep));
  let minSep = Infinity;
  for (let i = 0; i < n; i++) {
    const xi = x[i]!;
    const zi = z[i]!;
    for (let j = i + gapIdx; j < n; j++) {
      const cyc = Math.min(j - i, n - (j - i));
      if (cyc < gapIdx) continue;
      const d = Math.sqrt(idx.sampleDistSq(j, xi, zi));
      if (d < minSep) minSep = d;
    }
  }
  return minSep;
}

export function validateCircuit(
  control: ReadonlyArray<readonly [number, number, number]>,
  samples = VALIDATE_SAMPLES,
): ValidationResult {
  const s = sampleCurve(control, samples);
  const minR = minRadiusXZ(s);
  const si = hasSelfIntersection(s);
  const minSep = minSeparation(s);
  const ok = minR >= MIN_RADIUS && !si && minSep >= SEP_MIN;
  return { ok, length: s.length, minRadius: minR, minSeparation: minSep, selfIntersect: si };
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

// Seed-independent safety net: a smooth circle of circumference ~600 m. Always
// validates (radius ~100, no self-intersection, generous separation) so every
// seed terminates valid even if the mainline never converges.
function fallbackCircuit(): GeneratedCircuit {
  const R = 100;
  const n = 16;
  const control: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TWO_PI;
    control.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  const v = validateCircuit(control, VALIDATE_SAMPLES);
  return { control, worldSize: 2 * R + 2 * MARGIN, length: v.length };
}

/**
 * Seed -> drivable single closed loop. Each attempt draws a fresh mainline via
 * a deterministic sub-RNG; DISP_AMP shrinks and elongation pulls toward 1.0 as
 * attempts mount (rounder, gentler -> easier to validate). Circuits that exceed
 * the world cap are uniformly shrunk in XZ and re-validated. If every attempt
 * fails, a seed-independent fallback circle is returned.
 */
export function generateCircuit(seed: number): GeneratedCircuit {
  const seedU = seed >>> 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const t = MAX_ATTEMPTS > 1 ? attempt / (MAX_ATTEMPTS - 1) : 0;
    const dLo = 0.05 + (0.04 - 0.05) * t;
    const dHi = 0.13 + (0.07 - 0.13) * t;
    const eLo = 0.7 + (0.9 - 0.7) * t;
    const eHi = 1.3 + (1.1 - 1.3) * t;
    const subSeed = (Math.imul(seedU ^ 0x9e3779b1, 0x85ebca77) + attempt * 0xc2b2ae35) >>> 0;
    const rng = makeRNG(subSeed);
    let plan = buildMainline(rng, {
      dispAmpRange: [dLo, dHi],
      elongRange: [eLo, eHi],
    });
    if (plan.worldSize > WORLD_CAP) {
      plan = scalePlanXZ(plan, WORLD_CAP / plan.worldSize);
    }
    const v = validateCircuit(plan.control, VALIDATE_SAMPLES);
    if (v.ok && v.minRadius >= ACCEPT_RADIUS && v.length >= LEN_MIN && v.length <= LEN_MAX) {
      return { control: plan.control, worldSize: plan.worldSize, length: v.length };
    }
  }
  return fallbackCircuit();
}
