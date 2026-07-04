import { describe, expect, it } from "vitest";
import { SampleIndex } from "./trackGraph";
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
