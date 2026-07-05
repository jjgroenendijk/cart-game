import { describe, expect, it } from "vitest";
import {
  FOAM,
  WAVE,
  bilinearHeight,
  depthBelow,
  depthTintMix,
  foamMask,
  glintBand,
  rippleNormal,
  smoothstep,
  valueNoise,
} from "./waterShading";

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

describe("WAVE", () => {
  it("exports the celWater vertex shader literals (shared constants)", () => {
    expect(WAVE.AX).toBe(0.6);
    expect(WAVE.TX).toBe(1.1);
    expect(WAVE.AZ).toBe(0.5);
    expect(WAVE.TZ).toBe(0.9);
  });
});

describe("depthBelow", () => {
  it("is positive underwater and negative above the surface", () => {
    expect(depthBelow(5, 2)).toBe(3);
    expect(depthBelow(5, 6)).toBe(-1);
  });
});

describe("depthTintMix", () => {
  it("pins shallow=0, deep=1, midpoint=0.5", () => {
    expect(depthTintMix(0)).toBe(0);
    expect(depthTintMix(-2)).toBe(0);
    expect(depthTintMix(6)).toBe(1);
    expect(depthTintMix(10)).toBe(1);
    expect(depthTintMix(3)).toBeCloseTo(0.5, 6);
  });
});

describe("smoothstep", () => {
  it("is 0 at/below e0 and 1 at/above e1 (GLSL parity)", () => {
    expect(smoothstep(0.4, 1.2, 0)).toBe(0);
    expect(smoothstep(0.4, 1.2, 0.4)).toBe(0);
    expect(smoothstep(0.4, 1.2, 1.2)).toBe(1);
    expect(smoothstep(0.4, 1.2, 2)).toBe(1);
  });

  it("is 0.5 at the midpoint and monotonic increasing", () => {
    expect(smoothstep(0.4, 1.2, 0.8)).toBeCloseTo(0.5, 6);
    let prev = -Infinity;
    for (let x = 0.3; x <= 1.3; x += 0.05) {
      const v = smoothstep(0.4, 1.2, x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("bilinearHeight", () => {
  it("returns the matching corner at the unit-square corners", () => {
    expect(bilinearHeight(1, 2, 3, 4, 0, 0)).toBeCloseTo(1, 6);
    expect(bilinearHeight(1, 2, 3, 4, 1, 0)).toBeCloseTo(2, 6);
    expect(bilinearHeight(1, 2, 3, 4, 0, 1)).toBeCloseTo(3, 6);
    expect(bilinearHeight(1, 2, 3, 4, 1, 1)).toBeCloseTo(4, 6);
  });

  it("blends x then y (nested lerp) at the centre", () => {
    // mix(mix(0,10,.5)=5, mix(20,30,.5)=25, .5) = 15
    expect(bilinearHeight(0, 10, 20, 30, 0.5, 0.5)).toBeCloseTo(15, 6);
  });
});

describe("FOAM", () => {
  it("pins the foam tuning constants (mirrored into celWater GLSL)", () => {
    expect(FOAM.EDGE_INNER).toBe(0.2);
    expect(FOAM.EDGE_OUTER).toBe(0.65);
    expect(FOAM.WARP_FREQ).toBe(0.18);
    expect(FOAM.WARP_DRIFT).toBe(0.04);
    expect(FOAM.WARP_AMP).toBe(0.25);
    expect(FOAM.DETAIL_FREQ).toBe(0.9);
    expect(FOAM.DETAIL_DRIFT).toBe(0.15);
    expect(FOAM.DETAIL_GAIN).toBe(0.55);
    expect(FOAM.SLOPE_LO).toBe(0.12);
    expect(FOAM.SLOPE_HI).toBe(0.22);
    expect(FOAM.SLOPE_MIN).toBe(0.05);
  });
});

describe("valueNoise", () => {
  it("returns [0,1] and is deterministic (same input -> same output)", () => {
    for (let i = 0; i < 50; i++) {
      const v = valueNoise(i * 0.37, -i * 0.91);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(valueNoise(i * 0.37, -i * 0.91)).toBe(v);
    }
  });

  it("differs across lattice cells (not constant)", () => {
    const set = new Set([
      valueNoise(0, 0),
      valueNoise(1, 0),
      valueNoise(0, 1),
      valueNoise(1, 1),
      valueNoise(7, -3),
    ]);
    expect(set.size).toBeGreaterThan(1);
  });

  it("is continuous (tiny step -> tiny delta, C1 smoothstep blend)", () => {
    const v0 = valueNoise(4.2, -1.7);
    const v1 = valueNoise(4.2 + 1e-3, -1.7 + 1e-3);
    expect(Math.abs(v1 - v0)).toBeLessThan(1e-3);
  });
});

describe("foamMask", () => {
  // A steep bed slope (> SLOPE_HI) keeps the full gate; a flat one (~0) drops
  // it to SLOPE_MIN. Used across tests to isolate the foam shape from the gate.
  const STEEP = 0.4;

  it("stays in [0,1] across space, depth, slope, and time", () => {
    for (let x = -20; x <= 20; x += 4) {
      for (let z = -20; z <= 20; z += 4) {
        for (let depth = 0; depth <= 3; depth += 0.4) {
          for (const slope of [0, 0.12, 0.22, 0.4]) {
            const v = foamMask(x, z, depth, slope, 1, 7.3);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("is ~full at the waterline and zero well past the band (steep shore)", () => {
    // Warp is bounded +-WARP_AMP*width (0.45): depth 0.02 stays inside edge0
    // for most samples; depth 3.0 is past edge1 for every sample.
    let near = 0;
    let far = 1;
    for (let x = -20; x <= 20; x += 2) {
      for (let z = -20; z <= 20; z += 2) {
        near = Math.max(near, foamMask(x, z, 0.02, STEEP, 1, 0));
        far = Math.min(far, foamMask(x, z, 3.0, STEEP, 1, 0));
      }
    }
    expect(near).toBeGreaterThan(0.8);
    expect(far).toBe(0);
  });

  it("varies along the coast (organic contour, not a straight iso-curve)", () => {
    const vals = new Set<number>();
    for (let x = -20; x <= 20; x += 1) {
      // Same depth on the contour, different world XZ -> warped differently.
      vals.add(Math.round(foamMask(x, 5, 0.4, STEEP, 1, 0) * 1e4));
    }
    expect(vals.size).toBeGreaterThan(10);
  });

  it("laps over time at a fixed spot", () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t <= 30; t += 0.4) {
      const v = foamMask(3.5, -2.0, 0.4, STEEP, 1, t);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.05);
  });

  it("slope-gates foam: flat basins lose foam, steep shores keep it", () => {
    // Same mid-band spot/time; only the bed slope varies.
    const flat = foamMask(2.0, 1.0, 0.4, 0.0, 1.0, 3.0);
    const shore = foamMask(2.0, 1.0, 0.4, STEEP, 1.0, 3.0);
    expect(shore).toBeGreaterThan(flat);
    // Flat keeps at most SLOPE_MIN of a fully-gated band -> blue shows through.
    expect(flat).toBeLessThan(FOAM.SLOPE_MIN + 1e-6);
  });
});

describe("rippleNormal", () => {
  it("matches a finite difference of the two vertex sines and keeps ny dominant", () => {
    const amp = 0.15;
    const s = (x: number, z: number, t: number) =>
      amp * (Math.sin(WAVE.AX * x + WAVE.TX * t) + Math.sin(WAVE.AZ * z + WAVE.TZ * t));
    const h = 1e-4;
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [3.1, -2.2, 1.7],
      [-5, 5, 12],
      [10, -10, 100],
    ];
    for (const [x, z, t] of cases) {
      const dsdx = (s(x + h, z, t) - s(x - h, z, t)) / (2 * h);
      const dsdz = (s(x, z + h, t) - s(x, z - h, t)) / (2 * h);
      const fd = normalize3([-dsdx, 1, -dsdz]);
      const an = rippleNormal(x, z, t, amp);
      expect(an[0]).toBeCloseTo(fd[0], 3);
      expect(an[1]).toBeCloseTo(fd[1], 3);
      expect(an[2]).toBeCloseTo(fd[2], 3);
      expect(an[1]).toBeGreaterThan(Math.abs(an[0]));
      expect(an[1]).toBeGreaterThan(Math.abs(an[2]));
    }
  });
});

describe("glintBand", () => {
  it("is zero when intensity <= 0", () => {
    const n: [number, number, number] = [0, 1, 0];
    const sun: [number, number, number] = [1, 1, 0];
    const view: [number, number, number] = [1, 1, 0];
    expect(glintBand(n, sun, view, 0)).toBe(0);
    expect(glintBand(n, sun, view, -1)).toBe(0);
  });

  it("hits the 1.0 tier when the normal aligns with the half-vector", () => {
    const sun = normalize3([1, 1, 0]);
    const view = normalize3([1, 1, 0]);
    const H = normalize3([sun[0] + view[0], sun[1] + view[1], sun[2] + view[2]]);
    expect(glintBand(H, sun, view, 1)).toBe(1);
  });

  it("is zero at a grazing angle", () => {
    const n: [number, number, number] = [0, 1, 0];
    const sun: [number, number, number] = [1, 0, 0];
    const view: [number, number, number] = [1, 0, 0];
    expect(glintBand(n, sun, view, 1)).toBe(0);
  });

  it("only ever returns {0, 0.5, 1}", () => {
    const allowed = new Set([0, 0.5, 1]);
    const n = normalize3([0, 1, 0.05]);
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const sun: [number, number, number] = [Math.cos(a), Math.sin(a) * 0.5 + 0.5, 0.2];
      const view: [number, number, number] = [Math.cos(a + 0.3), 0.6, Math.sin(a)];
      for (const intensity of [0, 0.3, 0.7, 1, 2]) {
        expect(allowed.has(glintBand(n, sun, view, intensity))).toBe(true);
      }
    }
  });
});
