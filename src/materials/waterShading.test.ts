import { describe, expect, it } from "vitest";
import { WAVE, depthBelow, depthTintMix, foamMask, glintBand, rippleNormal } from "./waterShading";

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

describe("foamMask", () => {
  it("snaps to the two cel bands at rest (t=0)", () => {
    const w = 1;
    expect(foamMask(0.1, w, 0)).toBe(1); // below edge0 (0.4)
    expect(foamMask(0.8, w, 0)).toBe(0.5); // between edges (0.4..1.2)
    expect(foamMask(2, w, 0)).toBe(0); // above edge1 (1.2)
  });

  it("breathes across band edges over time at a boundary depth", () => {
    const w = 1;
    const vals = new Set<number>();
    for (let t = 0; t <= 20; t += 0.1) {
      vals.add(foamMask(0.4, w, t)); // depth == edge0
    }
    expect(vals.has(1)).toBe(true);
    expect(vals.has(0.5)).toBe(true);
  });

  it("only ever returns {0, 0.5, 1}", () => {
    const allowed = new Set([0, 0.5, 1]);
    for (let depth = 0; depth <= 3; depth += 0.07) {
      for (let t = 0; t <= 40; t += 0.37) {
        expect(allowed.has(foamMask(depth, 1, t))).toBe(true);
      }
    }
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
