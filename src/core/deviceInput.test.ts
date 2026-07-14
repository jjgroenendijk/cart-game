import { afterEach, describe, expect, it, vi } from "vitest";
import { isTouchDevice, pickTiltAngle, tiltToSteer, type TiltOptions } from "./deviceInput";

const OPTS = (over: Partial<TiltOptions> = {}): TiltOptions => ({
  sensitivity: 1,
  invert: false,
  deadzoneDeg: 5,
  maxDeg: 35,
  ...over,
});

describe("tiltToSteer", () => {
  it("returns 0 inside the deadzone around the baseline", () => {
    expect(tiltToSteer(3, 0, OPTS())).toBe(0);
    expect(tiltToSteer(-4, 0, OPTS())).toBe(0);
  });

  it("rolling right (angle > baseline) turns right: negative steer", () => {
    // Convention: positive steer = turn LEFT, so a right roll must be < 0.
    expect(tiltToSteer(20, 0, OPTS())).toBeLessThan(0);
  });

  it("rolling left (angle < baseline) turns left: positive steer", () => {
    expect(tiltToSteer(-20, 0, OPTS())).toBeGreaterThan(0);
  });

  it("saturates to full lock at/after maxDeg", () => {
    expect(tiltToSteer(35, 0, OPTS())).toBeCloseTo(-1, 6);
    expect(tiltToSteer(90, 0, OPTS())).toBe(-1);
    expect(tiltToSteer(-90, 0, OPTS())).toBe(1);
  });

  it("is relative to the captured baseline, not absolute zero", () => {
    // Baseline 30: holding at 30 is neutral; 50 is a right roll.
    expect(tiltToSteer(30, 30, OPTS())).toBe(0);
    expect(tiltToSteer(50, 30, OPTS())).toBeLessThan(0);
  });

  it("invert flips the sign", () => {
    const plain = tiltToSteer(20, 0, OPTS());
    const flipped = tiltToSteer(20, 0, OPTS({ invert: true }));
    expect(flipped).toBeCloseTo(-plain, 6);
  });

  it("higher sensitivity reaches full lock at a smaller tilt", () => {
    const low = Math.abs(tiltToSteer(15, 0, OPTS({ sensitivity: 0.5 })));
    const high = Math.abs(tiltToSteer(15, 0, OPTS({ sensitivity: 2 })));
    expect(high).toBeGreaterThan(low);
  });
});

describe("pickTiltAngle", () => {
  it("portrait (0) uses gamma", () => {
    expect(pickTiltAngle(0, 12, 7)).toBe(7);
  });

  it("landscape (90) uses -beta", () => {
    expect(pickTiltAngle(90, 12, 7)).toBe(-12);
  });

  it("landscape (270) uses beta", () => {
    expect(pickTiltAngle(270, 12, 7)).toBe(12);
    expect(pickTiltAngle(-90, 12, 7)).toBe(12);
  });

  it("upside-down portrait (180) uses -gamma", () => {
    expect(pickTiltAngle(180, 12, 7)).toBe(-7);
  });

  it("unknown angle falls back to gamma", () => {
    expect(pickTiltAngle(45, 12, 7)).toBe(7);
  });
});

describe("isTouchDevice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true when maxTouchPoints > 0", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 5 });
    expect(isTouchDevice()).toBe(true);
  });

  it("is true when a coarse pointer matches", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("coarse") }));
    expect(isTouchDevice()).toBe(true);
  });

  it("is false on a fine-pointer, no-touch environment", () => {
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isTouchDevice()).toBe(false);
  });
});
