import { describe, expect, it } from "vitest";
import { buoyancyForce, clampLife, DEFAULT_BUOYANCY, DEFAULT_LIFE, lifeDelta } from "./buoyancy";

describe("buoyancyForce", () => {
  it("depth <= 0 returns no force and no drag", () => {
    expect(buoyancyForce(0)).toEqual({ up: 0, drag: 1 });
    expect(buoyancyForce(-1)).toEqual({ up: 0, drag: 1 });
    expect(buoyancyForce(-0.001)).toEqual({ up: 0, drag: 1 });
  });

  it("up grows linearly with depth up to maxDepth", () => {
    const { floatStrength, maxDepth } = DEFAULT_BUOYANCY;
    expect(buoyancyForce(0.25).up).toBeCloseTo(floatStrength * 0.25, 6);
    expect(buoyancyForce(0.5).up).toBeCloseTo(floatStrength * 0.5, 6);
    expect(buoyancyForce(maxDepth).up).toBeCloseTo(floatStrength * maxDepth, 6);
  });

  it("up clamps at maxDepth", () => {
    const { maxDepth } = DEFAULT_BUOYANCY;
    const atMax = buoyancyForce(maxDepth).up;
    const beyond = buoyancyForce(10 * maxDepth).up;
    expect(beyond).toBeCloseTo(atMax, 6);
  });

  it("up at clamped maxDepth is ~60 (forgiving buoyant-neutral+)", () => {
    expect(buoyancyForce(DEFAULT_BUOYANCY.maxDepth).up).toBeCloseTo(60, 6);
  });

  it("drag equals dragFactor while submerged, 1 when not", () => {
    expect(buoyancyForce(0.5).drag).toBe(DEFAULT_BUOYANCY.dragFactor);
    expect(buoyancyForce(DEFAULT_BUOYANCY.maxDepth).drag).toBe(DEFAULT_BUOYANCY.dragFactor);
    expect(buoyancyForce(0).drag).toBe(1);
    expect(buoyancyForce(-2).drag).toBe(1);
  });
});

describe("lifeDelta", () => {
  it("submerged => negative drain of drainRate*dt", () => {
    const dt = 1 / 60;
    expect(lifeDelta(true, dt, 0.5)).toBeCloseTo(-(DEFAULT_LIFE.drainRate * dt), 6);
    expect(lifeDelta(true, dt, 0.5)).toBeLessThan(0);
  });

  it("not submerged => positive recover of recoverRate*dt", () => {
    const dt = 1 / 60;
    expect(lifeDelta(false, dt, 0.5)).toBeCloseTo(DEFAULT_LIFE.recoverRate * dt, 6);
    expect(lifeDelta(false, dt, 0.5)).toBeGreaterThan(0);
  });

  it("monotonic: larger dt => larger magnitude both directions", () => {
    const drainSmall = Math.abs(lifeDelta(true, 0.1, 1));
    const drainBig = Math.abs(lifeDelta(true, 0.5, 1));
    expect(drainBig).toBeGreaterThan(drainSmall);

    const recSmall = lifeDelta(false, 0.1, 0);
    const recBig = lifeDelta(false, 0.5, 0);
    expect(recBig).toBeGreaterThan(recSmall);
  });
});

describe("clampLife", () => {
  it("clamps to [0,1]", () => {
    expect(clampLife(-0.5)).toBe(0);
    expect(clampLife(1.5)).toBe(1);
    expect(clampLife(0.3)).toBeCloseTo(0.3, 6);
  });
});
