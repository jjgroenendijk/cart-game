import { describe, expect, it } from "vitest";
import { CatmullRomCurve3, Vector3 } from "three";
import { generateCircuit, validateCircuit } from "./circuit";

const SEEDS = 5000;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const WORLD_CAP = 768;

describe("generateCircuit — 5000-seed validity sweep", () => {
  it("every seed: valid, length, worldSize, extent", () => {
    let minLen = Infinity;
    let maxLen = 0;
    let minRadius = Infinity;
    let minSep = Infinity;
    let maxWorld = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const c = generateCircuit(seed);
      const v = validateCircuit(c.control, 256);
      // Drivability: radius >= 12.5, no self-intersection, separation >= 30 m.
      expect(v.ok, `seed ${seed} invalid: ${JSON.stringify(v)}`).toBe(true);
      // Length within 600-1500 m +-2% (588..1530).
      expect(c.length, `seed ${seed} length ${c.length}`).toBeGreaterThanOrEqual(LEN_MIN);
      expect(c.length, `seed ${seed} length ${c.length}`).toBeLessThanOrEqual(LEN_MAX);
      // Fits the world cap.
      expect(c.worldSize, `seed ${seed} worldSize ${c.worldSize}`).toBeLessThanOrEqual(
        WORLD_CAP + 1e-6,
      );
      // Every control point within the centered bbox (+/- worldSize/2).
      const half = c.worldSize / 2;
      for (const p of c.control) {
        expect(Math.abs(p[0]), `seed ${seed} ctrl x`).toBeLessThanOrEqual(half + 1e-6);
        expect(Math.abs(p[2]), `seed ${seed} ctrl z`).toBeLessThanOrEqual(half + 1e-6);
      }
      minLen = Math.min(minLen, c.length);
      maxLen = Math.max(maxLen, c.length);
      minRadius = Math.min(minRadius, v.minRadius);
      minSep = Math.min(minSep, v.minSeparation);
      maxWorld = Math.max(maxWorld, c.worldSize);
    }
    // Sanity: the sweep actually exercised the length/extent range rather
    // than collapsing to a single fallback value.
    expect(minRadius).toBeGreaterThanOrEqual(12.5);
    expect(minSep).toBeGreaterThanOrEqual(30);
    expect(maxWorld).toBeLessThanOrEqual(WORLD_CAP);
  }, 90000);
});

describe("generateCircuit — determinism", () => {
  it("same seed reproduces bit-identical control + worldSize + length", () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = generateCircuit(seed);
      const b = generateCircuit(seed);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("different seeds differ (the generator is actually seed-driven)", () => {
    const a = generateCircuit(1);
    const b = generateCircuit(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

// Indent ratio of the driven spline vs its convex envelope: 0 = convex blob,
// higher = concave/interesting (kidney/peanut/hook). Regression guard against
// the original convex-hull generator, which filled ~98% of its hull (mean
// indent ~0.02, ~92% of tracks near-round). The generator is deterministic, so
// these thresholds are stable across runs (no flakiness).
function polyArea(pts: ReadonlyArray<readonly [number, number]>): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
function hullArea(pts: ReadonlyArray<readonly [number, number]>): number {
  const sorted = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (
    o: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<readonly [number, number]> = [];
  for (const p of sorted) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop();
    lo.push(p);
  }
  const up: Array<readonly [number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop();
    up.push(p);
  }
  lo.pop();
  up.pop();
  return polyArea(lo.concat(up));
}
function splineIndent(control: ReadonlyArray<readonly [number, number, number]>): number {
  const v = control.map((c) => new Vector3(c[0], 0, c[2]));
  const curve = new CatmullRomCurve3(v, true, "centripetal");
  curve.arcLengthDivisions = 512;
  const sp = curve.getSpacedPoints(128).map((p) => [p.x, p.z] as const);
  const h = hullArea(sp);
  return h < 1e-6 ? 0 : (h - polyArea(sp)) / h;
}

describe("generateCircuit — shape variety (not boring round blobs)", () => {
  it("tracks carry real concavity, not just convex-hull scalloping", () => {
    const N = 300;
    let sum = 0;
    let concaveCount = 0;
    for (let seed = 0; seed < N; seed++) {
      const ind = splineIndent(generateCircuit(seed).control);
      sum += ind;
      if (ind >= 0.04) concaveCount++;
    }
    const mean = sum / N;
    // Original convex-hull generator sat at mean ~0.02 with ~8% >= 0.04. The
    // radial-profile + local de-kink generator reaches mean ~0.047 with ~40%.
    expect(mean, `mean spline-indent ${mean.toFixed(3)}`).toBeGreaterThanOrEqual(0.035);
    expect(concaveCount / N, `${concaveCount}/${N} concave`).toBeGreaterThanOrEqual(0.3);
  });
});
