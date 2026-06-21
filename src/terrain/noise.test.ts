import { describe, expect, it } from "vitest";
import { SimplexNoise2D } from "./noise";

describe("SimplexNoise2D", () => {
  it("output stays within [-1, 1] over a dense sample", () => {
    const n = new SimplexNoise2D(42);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 400; i++) {
      const v = n.noise(i * 0.31, i * 0.17);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    // Field is non-trivial (actually varies).
    expect(max - min).toBeGreaterThan(0.5);
  });

  it("is deterministic for a given seed", () => {
    const a = new SimplexNoise2D(7);
    const b = new SimplexNoise2D(7);
    for (let i = 0; i < 20; i++) {
      expect(a.noise(i * 0.5, i * 0.5)).toBe(b.noise(i * 0.5, i * 0.5));
    }
  });

  it("different seeds produce different fields", () => {
    const a = new SimplexNoise2D(1);
    const b = new SimplexNoise2D(2);
    let diffs = 0;
    for (let i = 0; i < 20; i++) {
      if (Math.abs(a.noise(i, i) - b.noise(i, i)) > 1e-4) diffs++;
    }
    expect(diffs).toBeGreaterThan(10);
  });

  it("noise(0,0) is zero (no gradient contribution at the origin cell center)", () => {
    // At the lattice origin the simplex kernels vanish; this pins a known point.
    const n = new SimplexNoise2D(99);
    expect(n.noise(0, 0)).toBeCloseTo(0, 6);
  });
});
