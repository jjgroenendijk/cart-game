import { describe, expect, it } from "vitest";
import { SNOW_BUILD_RATE, SNOW_MELT_RATE, easeToward } from "./snowAccum";

describe("snowAccum rate constants", () => {
  it("melt is slower than build (asymmetric)", () => {
    expect(SNOW_MELT_RATE).toBeLessThan(SNOW_BUILD_RATE);
    expect(SNOW_BUILD_RATE).toBeGreaterThan(0);
    expect(SNOW_MELT_RATE).toBeGreaterThan(0);
  });
});

describe("easeToward", () => {
  it("builds toward a higher target at buildRate", () => {
    const next = easeToward(0, 1, 1, 0.1, 0.02);
    expect(next).toBeCloseTo(0.1, 6); // 0 + buildRate*dt
  });

  it("melts toward a lower target at meltRate", () => {
    const next = easeToward(1, 0, 1, 0.1, 0.02);
    expect(next).toBeCloseTo(0.98, 6); // 1 - meltRate*dt
  });

  it("build reaches the target faster than melt (same span + dt)", () => {
    // Steps to climb 0 -> 1 vs fall 1 -> 0 under the default rates.
    let up = 0;
    let upSteps = 0;
    while (up < 1 && upSteps < 100000) {
      up = easeToward(up, 1, 1);
      upSteps++;
    }
    let down = 1;
    let downSteps = 0;
    while (down > 0 && downSteps < 100000) {
      down = easeToward(down, 0, 1);
      downSteps++;
    }
    expect(upSteps).toBeLessThan(downSteps);
  });

  it("dt-scaling: one dt=0.2 step equals two dt=0.1 steps (unclamped)", () => {
    const big = easeToward(0, 1, 0.2, 0.5, 0.02); // 0.5*0.2 = 0.1
    let small = easeToward(0, 1, 0.1, 0.5, 0.02);
    small = easeToward(small, 1, 0.1, 0.5, 0.02);
    expect(big).toBeCloseTo(small, 6);
    expect(big).toBeCloseTo(0.1, 6);
  });

  it("never overshoots when the step exceeds the remaining distance (build)", () => {
    const next = easeToward(0.9, 1, 100, 0.5, 0.02); // step 50 >> 0.1 remaining
    expect(next).toBe(1);
  });

  it("never overshoots when the step exceeds the remaining distance (melt)", () => {
    const next = easeToward(0.1, 0, 100, 0.5, 0.5); // step 50 >> 0.1 remaining
    expect(next).toBe(0);
  });

  it("reaches the target exactly after enough steps (build)", () => {
    let cur = 0;
    for (let i = 0; i < 1000; i++) cur = easeToward(cur, 1, 1);
    expect(cur).toBe(1);
  });

  it("reaches the target exactly after enough steps (melt)", () => {
    let cur = 1;
    for (let i = 0; i < 1000; i++) cur = easeToward(cur, 0, 1);
    expect(cur).toBe(0);
  });

  it("is monotonic while building (only increases)", () => {
    let cur = 0;
    for (let i = 0; i < 5; i++) {
      const next = easeToward(cur, 1, 1);
      expect(next).toBeGreaterThanOrEqual(cur);
      cur = next;
    }
  });

  it("is monotonic while melting (only decreases)", () => {
    let cur = 1;
    for (let i = 0; i < 5; i++) {
      const next = easeToward(cur, 0, 1);
      expect(next).toBeLessThanOrEqual(cur);
      cur = next;
    }
  });

  it("non-positive dt returns cur unchanged", () => {
    expect(easeToward(0.4, 1, 0)).toBe(0.4);
    expect(easeToward(0.4, 1, -1)).toBe(0.4);
  });

  it("cur already at target returns cur unchanged", () => {
    expect(easeToward(0.5, 0.5, 1)).toBe(0.5);
  });
});
