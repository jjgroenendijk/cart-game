import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FREE_FLY_DEFAULTS,
  orientationFromYawPitch,
  stepFreeFly,
  type FreeFlyInput,
  type FreeFlyState,
} from "./freeFly";

const ZERO_INPUT: FreeFlyInput = {
  forward: 0,
  right: 0,
  up: 0,
  yawDelta: 0,
  pitchDelta: 0,
  boost: false,
};

const INPUT = (over: Partial<FreeFlyInput> = {}): FreeFlyInput => ({ ...ZERO_INPUT, ...over });

const STATE = (over: Partial<FreeFlyState> = {}): FreeFlyState => ({
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
  pitch: 0,
  ...over,
});

describe("orientationFromYawPitch", () => {
  it("looks down -Z at yaw=pitch=0", () => {
    const { forward } = orientationFromYawPitch(0, 0);
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(-1, 6);
  });

  it("positive yaw turns the look toward -X", () => {
    const { forward } = orientationFromYawPitch(Math.PI / 2, 0);
    expect(forward.x).toBeCloseTo(-1, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

  it("positive pitch tilts the look up (+Y)", () => {
    const { forward } = orientationFromYawPitch(0, Math.PI / 4);
    expect(forward.y).toBeGreaterThan(0);
  });

  it("forward matches the quaternion applied to -Z", () => {
    const { forward, quaternion } = orientationFromYawPitch(0.7, -0.3);
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    expect(forward.x).toBeCloseTo(v.x, 6);
    expect(forward.y).toBeCloseTo(v.y, 6);
    expect(forward.z).toBeCloseTo(v.z, 6);
  });
});

describe("stepFreeFly", () => {
  it("clamps pitch at the limit", () => {
    const limit = FREE_FLY_DEFAULTS.pitchLimit;
    const up = stepFreeFly(STATE({ pitch: limit }), INPUT({ pitchDelta: 1 }), 0.016);
    expect(up.pitch).toBeCloseTo(limit, 9);
    const down = stepFreeFly(STATE({ pitch: -limit }), INPUT({ pitchDelta: -1 }), 0.016);
    expect(down.pitch).toBeCloseTo(-limit, 9);
  });

  it("W moves along the look direction", () => {
    const dt = 0.5;
    const next = stepFreeFly(STATE(), INPUT({ forward: 1 }), dt);
    const dist = FREE_FLY_DEFAULTS.baseSpeed * dt;
    // Default look is -Z, so W advances -Z by exactly speed*dt.
    expect(next.position.x).toBeCloseTo(0, 6);
    expect(next.position.y).toBeCloseTo(0, 6);
    expect(next.position.z).toBeCloseTo(-dist, 6);
  });

  it("yaw rotates the movement direction of W", () => {
    const dt = 0.5;
    const next = stepFreeFly(STATE({ yaw: Math.PI / 2 }), INPUT({ forward: 1 }), dt);
    const dist = FREE_FLY_DEFAULTS.baseSpeed * dt;
    // Yaw +90deg points the look at -X, so W now advances -X.
    expect(next.position.x).toBeCloseTo(-dist, 6);
    expect(next.position.z).toBeCloseTo(0, 6);
  });

  it("boost scales the travelled distance", () => {
    const dt = 0.25;
    const plain = stepFreeFly(STATE(), INPUT({ forward: 1 }), dt);
    const boosted = stepFreeFly(STATE(), INPUT({ forward: 1, boost: true }), dt);
    expect(Math.abs(boosted.position.z)).toBeCloseTo(
      Math.abs(plain.position.z) * FREE_FLY_DEFAULTS.boostMultiplier,
      6,
    );
  });

  it("scales distance linearly with dt", () => {
    const a = stepFreeFly(STATE(), INPUT({ forward: 1 }), 0.1);
    const b = stepFreeFly(STATE(), INPUT({ forward: 1 }), 0.2);
    expect(Math.abs(b.position.z)).toBeCloseTo(Math.abs(a.position.z) * 2, 6);
  });

  it("normalizes diagonals so they are not faster than a single axis", () => {
    const dt = 0.5;
    const diag = stepFreeFly(STATE(), INPUT({ forward: 1, right: 1 }), dt);
    const speed = Math.hypot(diag.position.x, diag.position.y, diag.position.z);
    expect(speed).toBeCloseTo(FREE_FLY_DEFAULTS.baseSpeed * dt, 6);
  });

  it("Q/E move along world up regardless of look pitch", () => {
    const dt = 0.5;
    const next = stepFreeFly(STATE({ pitch: FREE_FLY_DEFAULTS.pitchLimit }), INPUT({ up: 1 }), dt);
    expect(next.position.y).toBeCloseTo(FREE_FLY_DEFAULTS.baseSpeed * dt, 6);
  });

  it("leaves position unchanged for zero input", () => {
    const start = STATE({ position: { x: 3, y: 4, z: 5 }, yaw: 0.4, pitch: 0.2 });
    const next = stepFreeFly(start, ZERO_INPUT, 0.016);
    expect(next.position).toEqual(start.position);
    expect(next.yaw).toBe(start.yaw);
    expect(next.pitch).toBe(start.pitch);
  });

  it("applies mouse deltas to yaw and pitch", () => {
    const next = stepFreeFly(STATE(), INPUT({ yawDelta: 0.1, pitchDelta: -0.05 }), 0.016);
    expect(next.yaw).toBeCloseTo(0.1, 9);
    expect(next.pitch).toBeCloseTo(-0.05, 9);
  });
});
