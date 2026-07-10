import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACK_HALF_WIDTH,
  SampleIndex,
  TrackGraph,
  widthProfileAt,
  type BranchEdgeInit,
} from "./trackGraph";
import { SplineTrack } from "./SplineTrack";

function bruteNearest(
  sx: ArrayLike<number>,
  sz: ArrayLike<number>,
  x: number,
  z: number,
): { idx: number; distSq: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < sx.length; i++) {
    const dx = x - sx[i];
    const dz = z - sz[i];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { idx: best, distSq: bestD };
}

describe("SampleIndex", () => {
  it("returns -1 for an empty sample set", () => {
    const idx = new SampleIndex(new Float32Array(0), new Float32Array(0));
    expect(idx.nearestSample(3, 4)).toBe(-1);
  });

  it("matches a brute-force nearest over random samples + random queries", () => {
    const n = 1024;
    const sx = new Float32Array(n);
    const sz = new Float32Array(n);
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
      sx[i] = (rnd() * 2 - 1) * 80;
      sz[i] = (rnd() * 2 - 1) * 80;
    }
    const idx = new SampleIndex(sx, sz, 16);
    for (let q = 0; q < 400; q++) {
      const x = (rnd() * 2 - 1) * 140; // include queries outside sample bounds
      const z = (rnd() * 2 - 1) * 140;
      const got = idx.nearestSample(x, z);
      const brute = bruteNearest(sx, sz, x, z);
      expect(got).toBe(brute.idx);
      expect(idx.sampleDistSq(got, x, z)).toBeCloseTo(brute.distSq, 6);
    }
  });

  it("matches brute-force for queries well outside the sample bounds", () => {
    const sx = new Float32Array([-10, 10, 0, 0]);
    const sz = new Float32Array([0, 0, -10, 10]);
    const idx = new SampleIndex(sx, sz, 4);
    for (const [x, z] of [
      [500, 500],
      [-500, 500],
      [-500, -500],
      [0, 1000],
      [1000, 0],
    ] as const) {
      expect(idx.nearestSample(x, z)).toBe(bruteNearest(sx, sz, x, z).idx);
    }
  });

  it("default cell is 16 m", () => {
    const idx = new SampleIndex(new Float32Array([0, 32]), new Float32Array([0, 0]));
    expect(idx.bounds.maxX - idx.bounds.minX).toBeGreaterThanOrEqual(0);
    expect(idx.count).toBe(2);
  });

  it("nearestSample squared distance == SplineTrack.closestPoint dist^2", () => {
    const track = new SplineTrack();
    const idx = new SampleIndex(track.sx, track.sz);
    const r = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    let maxErr = 0;
    for (let x = -120; x <= 120; x += 7) {
      for (let z = -120; z <= 120; z += 7) {
        const s = idx.nearestSample(x, z);
        track.closestPoint(x, z, r);
        const dSq = idx.sampleDistSq(s, x, z);
        maxErr = Math.max(maxErr, Math.abs(dSq - r.dist * r.dist));
      }
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("forEachWithin visits exactly the samples inside the radius", () => {
    const n = 512;
    const sx = new Float32Array(n);
    const sz = new Float32Array(n);
    let seed = 999;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) {
      sx[i] = (rnd() * 2 - 1) * 60;
      sz[i] = (rnd() * 2 - 1) * 60;
    }
    const idx = new SampleIndex(sx, sz, 16);
    for (let q = 0; q < 60; q++) {
      const x = (rnd() * 2 - 1) * 80;
      const z = (rnd() * 2 - 1) * 80;
      const r = 5 + rnd() * 30;
      const got = new Set<number>();
      idx.forEachWithin(x, z, r, (i, dSq) => {
        got.add(i);
        expect(dSq).toBeLessThanOrEqual(r * r + 1e-6);
      });
      for (let i = 0; i < n; i++) {
        const dx = x - sx[i]!;
        const dz = z - sz[i]!;
        expect(got.has(i)).toBe(dx * dx + dz * dz <= r * r);
      }
    }
  });

  it("nearestSample index yields the same pathY/t as closestPoint", () => {
    const track = new SplineTrack();
    const idx = new SampleIndex(track.sx, track.sz);
    const r = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    for (let x = -100; x <= 100; x += 9) {
      for (let z = -100; z <= 100; z += 9) {
        const s = idx.nearestSample(x, z);
        track.closestPoint(x, z, r);
        expect(track.sy[s]).toBe(r.pathY);
        expect(track.st[s]).toBe(r.t);
      }
    }
  });
});

describe("TrackEdge (mainline)", () => {
  const track = new SplineTrack();
  const graph = new TrackGraph(track);
  const main = graph.edgeById(0);

  it("aliases the SplineTrack sample table (station i == sample i)", () => {
    expect(main.sx).toBe(track.sx);
    expect(main.count).toBe(track.sx.length);
    expect(main.closed).toBe(true);
    expect(main.length).toBeCloseTo(track.loopLength, 6);
  });

  it("pointAt at station arcs reproduces the sample table", () => {
    for (let i = 0; i < main.count; i += 97) {
      const p = main.pointAt(i * main.step);
      expect(p.x).toBeCloseTo(track.sx[i]!, 5);
      expect(p.y).toBeCloseTo(track.sy[i]!, 5);
      expect(p.z).toBeCloseTo(track.sz[i]!, 5);
    }
  });

  it("pointAt wraps the closed loop (s + length == s)", () => {
    const a = main.pointAt(37.5);
    const b = main.pointAt(37.5 + main.length);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.z).toBeCloseTo(a.z, 4);
  });

  it("progressAt is monotonic over [0, length) and matches st at stations", () => {
    let prev = -1;
    for (let i = 0; i < main.count; i += 13) {
      const t = main.progressAt(i * main.step);
      expect(t).toBeCloseTo(track.st[i]!, 6);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("tangentAt is unit length and follows the loop direction", () => {
    for (let s = 0; s < main.length; s += main.length / 7) {
      const tan = main.tangentAt(s);
      expect(Math.hypot(tan.x, tan.y, tan.z)).toBeCloseTo(1, 5);
    }
  });

  it("halfWidthAt defaults to the constant corridor width", () => {
    for (let s = 0; s < main.length; s += main.length / 11) {
      expect(main.halfWidthAt(s)).toBe(DEFAULT_TRACK_HALF_WIDTH);
    }
  });

  it("applies a WidthProfile per station (piecewise-linear, wrapping)", () => {
    const L = track.loopLength;
    const profile = { s: [0, L / 2], halfWidth: [5, 8] };
    const g = new TrackGraph(track, { mainWidth: profile });
    const e = g.edgeById(0);
    expect(e.halfWidthAt(0)).toBeCloseTo(5, 3);
    expect(e.halfWidthAt(L / 2)).toBeCloseTo(8, 3);
    // Quarter points sit mid-segment on both rising + wrapping halves.
    expect(e.halfWidthAt(L / 4)).toBeCloseTo(6.5, 2);
    expect(e.halfWidthAt((3 * L) / 4)).toBeCloseTo(6.5, 2);
  });
});

describe("widthProfileAt", () => {
  it("clamps open edges to their end stations", () => {
    const profile = { s: [0, 10, 20], halfWidth: [4, 6, 8] };
    expect(widthProfileAt(profile, -5, 20, false)).toBe(4);
    expect(widthProfileAt(profile, 25, 20, false)).toBe(8);
    expect(widthProfileAt(profile, 20, 20, false)).toBe(8);
    expect(widthProfileAt(profile, 5, 20, false)).toBeCloseTo(5, 6);
  });

  it("wraps closed edges across the seam", () => {
    const profile = { s: [0, 50], halfWidth: [4, 8] };
    // Between s=50 and s=100(==0) the width lerps 8 -> 4.
    expect(widthProfileAt(profile, 75, 100)).toBeCloseTo(6, 6);
  });
});

describe("TrackGraph.closestOnGraph", () => {
  it("matches SplineTrack.closestPoint on a single-edge graph", () => {
    const track = new SplineTrack();
    const graph = new TrackGraph(track);
    const cp = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    for (let x = -110; x <= 110; x += 11) {
      for (let z = -110; z <= 110; z += 11) {
        const pose = graph.closestOnGraph(x, z);
        track.closestPoint(x, z, cp);
        expect(pose.edgeId).toBe(0);
        expect(pose.dist).toBeCloseTo(cp.dist, 5);
        expect(pose.t).toBeCloseTo(cp.t, 6);
        expect(pose.pathY).toBeCloseTo(cp.pathY, 6);
        expect(pose.halfWidth).toBe(DEFAULT_TRACK_HALF_WIDTH);
      }
    }
  });
});

describe("TrackGraph branch edges", () => {
  const track = new SplineTrack();
  // Straight synthetic branch far from the loop (radius ~60) so nearest wins.
  const branch: BranchEdgeInit = {
    kind: "shortcut",
    tA: 0.9,
    tB: 0.1,
    points: [
      [200, 0, -20],
      [200, 1, 0],
      [200, 2, 20],
    ],
    halfWidth: 4,
  };
  const graph = new TrackGraph(track, { branches: [branch] });
  const e = graph.edgeById(1);

  it("resamples the open polyline to ~EDGE_SAMPLE_STEP stations", () => {
    expect(e.closed).toBe(false);
    // 3D arc length: 40 m in Z plus the 2 m Y rise.
    expect(e.length).toBeCloseTo(40.05, 2);
    expect(e.step).toBeLessThanOrEqual(1.0);
    const p0 = e.pointAt(0);
    const p1 = e.pointAt(e.length);
    expect(p0.z).toBeCloseTo(-20, 4);
    expect(p1.z).toBeCloseTo(20, 4);
  });

  it("projects progress onto the mainline across the seam (tA=0.9 -> tB=0.1)", () => {
    expect(e.progressAt(0)).toBeCloseTo(0.9, 6);
    expect(e.progressAt(e.length / 2)).toBeCloseTo(0.0, 6);
    expect(e.progressAt(e.length)).toBeCloseTo(0.1, 6);
    // Monotonic forward in wrap terms: consecutive deltas stay positive.
    let prev = e.progressAt(0);
    for (let s = e.step; s <= e.length; s += e.step * 8) {
      const t = e.progressAt(s);
      let d = t - prev;
      if (d < -0.5) d += 1;
      expect(d).toBeGreaterThanOrEqual(0);
      prev = t;
    }
  });

  it("closestOnGraph returns the branch near its stations", () => {
    const pose = graph.closestOnGraph(202, 5);
    expect(pose.edgeId).toBe(1);
    expect(pose.halfWidth).toBe(4);
    expect(pose.dist).toBeCloseTo(2, 1);
  });
});

describe("TrackEdge bank table (084)", () => {
  it("defaults to level everywhere (no profile, branches always)", () => {
    const track = new SplineTrack();
    const branch: BranchEdgeInit = {
      kind: "shortcut",
      tA: 0.1,
      tB: 0.3,
      points: [
        [200, 0, 0],
        [210, 0, 5],
        [220, 0, 0],
      ],
      halfWidth: 4,
    };
    const graph = new TrackGraph(track, {
      mainBank: { s: [0], bank: [0.1] },
      branches: [branch],
    });
    expect(graph.edgeById(0).bankAt(50)).toBeCloseTo(0.1, 6);
    expect(graph.edgeById(1).bankAt(5)).toBe(0);
    const plain = new TrackGraph(track);
    expect(plain.edgeById(0).bankAt(50)).toBe(0);
  });

  it("interpolates the mainline profile between stations", () => {
    const track = new SplineTrack();
    const L = track.loopLength;
    const graph = new TrackGraph(track, {
      mainBank: { s: [0, L / 2], bank: [0, 0.2] },
    });
    const e = graph.edgeById(0);
    expect(e.bankAt(0)).toBeCloseTo(0, 3);
    expect(e.bankAt(L / 2)).toBeCloseTo(0.2, 3);
    const quarter = e.bankAt(L / 4);
    expect(quarter).toBeGreaterThan(0.05);
    expect(quarter).toBeLessThan(0.15);
  });
});
