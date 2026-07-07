import { describe, expect, it } from "vitest";
import { engineCurve } from "./engineCurve";

const MS = 34; // DEFAULT_TUNING.maxSpeed

describe("engineCurve — endpoints", () => {
  it("freq = idleHz * lowRatio at speed 0 (gear 0, local 0)", () => {
    const r = engineCurve({ speed: 0, maxSpeed: MS, throttle: 0 });
    expect(r.freq).toBeCloseTo(55 * 0.55, 5);
    expect(r.gear).toBe(0);
  });

  it("freq = topHz at maxSpeed (top gear, local 1)", () => {
    const r = engineCurve({ speed: MS, maxSpeed: MS, throttle: 1 });
    expect(r.freq).toBeCloseTo(320, 4);
    expect(r.gear).toBe(5);
  });

  it("clamps above maxSpeed (no overflow past top gear)", () => {
    const r = engineCurve({ speed: MS * 2, maxSpeed: MS, throttle: 1 });
    expect(r.gear).toBe(5);
    expect(r.freq).toBeCloseTo(320, 4);
  });

  it("negative speed (reverse) clamps to idle (speed01=0)", () => {
    const r = engineCurve({ speed: -10, maxSpeed: MS, throttle: 0 });
    expect(r.gear).toBe(0);
    expect(r.freq).toBeCloseTo(55 * 0.55, 5);
  });

  it("maxSpeed=0 degrades to idle (no divide-by-zero)", () => {
    const r = engineCurve({ speed: 5, maxSpeed: 0, throttle: 1 });
    expect(r.gear).toBe(0);
    expect(r.freq).toBeCloseTo(55 * 0.55, 5);
  });
});

describe("engineCurve — within-gear monotonic rise", () => {
  it("freq rises monotonically inside each gear band", () => {
    const bands = 6;
    for (let g = 0; g < bands; g++) {
      const lo = (g / bands) * MS + 1e-6;
      const hi = ((g + 1) / bands) * MS - 1e-6;
      const fLo = engineCurve({ speed: lo, maxSpeed: MS, throttle: 1 }).freq;
      const fHi = engineCurve({ speed: hi, maxSpeed: MS, throttle: 1 }).freq;
      expect(fHi).toBeGreaterThan(fLo);
    }
  });
});

describe("engineCurve — shift points drop freq (arcade)", () => {
  it("freq drops at each of the 5 gear boundaries", () => {
    const bands = 6;
    const dropFactor = 1.423 * 0.55; // pow(top/idle,1/5) * lowRatio/highRatio
    for (let g = 0; g < bands - 1; g++) {
      const boundary = ((g + 1) / bands) * MS;
      const below = engineCurve({
        speed: boundary - 1e-6,
        maxSpeed: MS,
        throttle: 1,
      }).freq;
      const above = engineCurve({
        speed: boundary + 1e-6,
        maxSpeed: MS,
        throttle: 1,
      }).freq;
      // Each shift drops to ~dropFactor of the pre-shift peak.
      expect(above).toBeLessThan(below);
      expect(above / below).toBeCloseTo(dropFactor, 1);
    }
  });
});

describe("engineCurve — gain", () => {
  it("gain = idleGain when throttle <= 0", () => {
    expect(engineCurve({ speed: 10, maxSpeed: MS, throttle: 0 }).gain).toBeCloseTo(0.05, 5);
    expect(engineCurve({ speed: 10, maxSpeed: MS, throttle: -1 }).gain).toBeCloseTo(0.05, 5);
  });

  it("gain rises with throttle > 0 toward fullGain", () => {
    const g0 = engineCurve({ speed: 10, maxSpeed: MS, throttle: 0.01 }).gain;
    const gMid = engineCurve({ speed: 10, maxSpeed: MS, throttle: 0.5 }).gain;
    const gFull = engineCurve({ speed: 10, maxSpeed: MS, throttle: 1 }).gain;
    expect(gFull).toBeGreaterThan(gMid);
    expect(gMid).toBeGreaterThan(g0);
    expect(gFull).toBeCloseTo(0.2, 5);
  });

  it("gain is speed-independent (only throttle-driven)", () => {
    const a = engineCurve({ speed: 0, maxSpeed: MS, throttle: 0.7 }).gain;
    const b = engineCurve({ speed: 30, maxSpeed: MS, throttle: 0.7 }).gain;
    expect(a).toBeCloseTo(b, 5);
  });
});

describe("engineCurve — low gear counts stay finite", () => {
  it("returns finite freq/gain for gears in {0,1,2,6} across speed01 sweep", () => {
    for (const gears of [0, 1, 2, 6]) {
      for (let s = 0; s <= 20; s++) {
        const speed01 = s / 20;
        const speed = speed01 * MS;
        const r = engineCurve({ speed, maxSpeed: MS, throttle: 0.5 }, { gears });
        expect(Number.isFinite(r.freq)).toBe(true);
        expect(Number.isFinite(r.gain)).toBe(true);
        expect(Number.isFinite(r.gear)).toBe(true);
      }
    }
  });
});

describe("engineCurve — determinism", () => {
  it("same inputs -> same outputs (pure)", () => {
    const args = { speed: 17.3, maxSpeed: MS, throttle: 0.42 } as const;
    const a = engineCurve(args);
    const b = engineCurve(args);
    expect(a).toEqual(b);
  });
});
