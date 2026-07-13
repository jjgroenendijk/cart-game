import { describe, expect, it } from "vitest";
import {
  isTouchDevice,
  normalizeOrientationAngle,
  readTiltAxis,
  resolveTiltAxis,
  tiltToSteer,
} from "./tiltSteer";

describe("normalizeOrientationAngle", () => {
  it("snaps arbitrary angles to the nearest quadrant", () => {
    expect(normalizeOrientationAngle(0)).toBe(0);
    expect(normalizeOrientationAngle(88)).toBe(90);
    expect(normalizeOrientationAngle(181)).toBe(180);
    expect(normalizeOrientationAngle(-90)).toBe(270);
    expect(normalizeOrientationAngle(360)).toBe(0);
  });
});

describe("resolveTiltAxis", () => {
  it("uses gamma in portrait and beta in landscape", () => {
    expect(resolveTiltAxis(0)).toEqual({ axis: "gamma", sign: 1 });
    expect(resolveTiltAxis(180)).toEqual({ axis: "gamma", sign: -1 });
    expect(resolveTiltAxis(90)).toEqual({ axis: "beta", sign: 1 });
    expect(resolveTiltAxis(270)).toEqual({ axis: "beta", sign: -1 });
  });
});

describe("readTiltAxis", () => {
  it("reads the axis chosen by orientation", () => {
    expect(readTiltAxis({ beta: 10, gamma: 20 }, 0)).toBe(20); // portrait -> gamma
    expect(readTiltAxis({ beta: 10, gamma: 20 }, 90)).toBe(10); // landscape -> beta
    expect(readTiltAxis({ beta: null, gamma: 20 }, 90)).toBeNull();
  });
});

describe("tiltToSteer", () => {
  it("returns 0 inside the deadzone", () => {
    expect(tiltToSteer({ beta: 0, gamma: 2 }, { angle: 0, neutral: 0 })).toBe(0);
  });

  it("tilting the right edge down steers right (negative)", () => {
    // Portrait: gamma > 0 = right edge down = turn right = negative steer.
    const steer = tiltToSteer({ beta: 0, gamma: 20 }, { angle: 0, neutral: 0 });
    expect(steer).toBeLessThan(0);
  });

  it("tilting the left edge down steers left (positive)", () => {
    const steer = tiltToSteer({ beta: 0, gamma: -20 }, { angle: 0, neutral: 0 });
    expect(steer).toBeGreaterThan(0);
  });

  it("clamps to full lock past the range", () => {
    const steer = tiltToSteer({ beta: 0, gamma: 90 }, { angle: 0, neutral: 0, rangeDeg: 20 });
    expect(steer).toBeCloseTo(-1);
  });

  it("applies the calibrated neutral baseline", () => {
    // Held flat at gamma=15; a reading back at 15 is neutral -> 0 steer.
    expect(tiltToSteer({ beta: 0, gamma: 15 }, { angle: 0, neutral: 15 })).toBe(0);
  });

  it("invert flips the steer direction", () => {
    const opts = { angle: 0, neutral: 0 };
    const normal = tiltToSteer({ beta: 0, gamma: 20 }, opts);
    const flipped = tiltToSteer({ beta: 0, gamma: 20 }, { ...opts, invert: true });
    expect(Math.sign(flipped)).toBe(-Math.sign(normal));
  });

  it("landscape reads beta and flips sign at 270", () => {
    const at90 = tiltToSteer({ beta: 20, gamma: 0 }, { angle: 90, neutral: 0 });
    const at270 = tiltToSteer({ beta: 20, gamma: 0 }, { angle: 270, neutral: 0 });
    expect(Math.sign(at90)).toBe(-Math.sign(at270));
  });

  it("returns 0 for a missing or non-finite axis", () => {
    expect(tiltToSteer({ beta: null, gamma: null }, { angle: 90, neutral: 0 })).toBe(0);
    expect(tiltToSteer({ beta: NaN, gamma: 0 }, { angle: 90, neutral: 0 })).toBe(0);
  });
});

describe("isTouchDevice", () => {
  it("returns a boolean without throwing under jsdom", () => {
    expect(typeof isTouchDevice()).toBe("boolean");
  });
});
