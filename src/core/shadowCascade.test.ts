import { describe, expect, it } from "vitest";
import { cascadeBlendWeight, cascadeFor } from "./shadowCascade";

describe("cascadeBlendWeight", () => {
  it("returns 0 when blendWidth <= 0 (single cascade / low tier)", () => {
    for (const blendWidth of [0, -1, -0.5]) {
      expect(cascadeBlendWeight(0, 40, blendWidth)).toBe(0);
      expect(cascadeBlendWeight(100, 40, blendWidth)).toBe(0);
      expect(cascadeBlendWeight(1e9, 40, blendWidth)).toBe(0);
    }
  });

  it("returns 0 below the band start (split - blendWidth)", () => {
    // split=40, blendWidth=8 -> band start 32
    expect(cascadeBlendWeight(31, 40, 8)).toBe(0);
    expect(cascadeBlendWeight(31.9, 40, 8)).toBe(0);
    expect(cascadeBlendWeight(32, 40, 8)).toBe(0); // exactly band start
  });

  it("returns 1 at and above split", () => {
    // split=40, blendWidth=8 -> band start 32
    expect(cascadeBlendWeight(40, 40, 8)).toBe(1);
    expect(cascadeBlendWeight(50, 40, 8)).toBe(1);
    expect(cascadeBlendWeight(1e6, 40, 8)).toBe(1);
  });

  it("rises smoothly across the band", () => {
    // split=40, blendWidth=8 -> band [32,40]
    expect(cascadeBlendWeight(34, 40, 8)).toBeCloseTo(0.25, 10);
    expect(cascadeBlendWeight(36, 40, 8)).toBeCloseTo(0.5, 10);
    expect(cascadeBlendWeight(38, 40, 8)).toBeCloseTo(0.75, 10);
  });

  it("hits the exact midpoint value at split=40, blendWidth=8 -> viewDist=36 === 0.5", () => {
    expect(cascadeBlendWeight(36, 40, 8)).toBe(0.5);
  });

  it("clamps to exactly 1 far beyond split", () => {
    expect(cascadeBlendWeight(1e9, 40, 8)).toBe(1);
  });

  it("clamps negative viewDist to exactly 0", () => {
    expect(cascadeBlendWeight(-1000, 40, 8)).toBe(0);
    expect(cascadeBlendWeight(-0.1, 40, 8)).toBe(0);
  });

  it("is symmetric to 1 across the band (weight + complement at mirror point)", () => {
    // band [32,40]: weight(34) + weight(38) = 0.25 + 0.75 = 1
    expect(cascadeBlendWeight(34, 40, 8) + cascadeBlendWeight(38, 40, 8)).toBeCloseTo(1, 10);
  });

  it("tier-like low case: split=0, blendWidth=0 -> always 0", () => {
    for (const d of [0, 1, 10, 100, 1000]) {
      expect(cascadeBlendWeight(d, 0, 0)).toBe(0);
    }
  });

  it("med case split=40 blendWidth=8: weight(30)=0 weight(40)=1 weight(36)=0.5", () => {
    expect(cascadeBlendWeight(30, 40, 8)).toBe(0);
    expect(cascadeBlendWeight(40, 40, 8)).toBe(1);
    expect(cascadeBlendWeight(36, 40, 8)).toBe(0.5);
  });

  it("monotonically non-decreasing across viewDist", () => {
    let prev = -Infinity;
    for (let d = 0; d <= 60; d += 0.5) {
      const w = cascadeBlendWeight(d, 40, 8);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });
});

describe("cascadeFor", () => {
  it("returns 0 below the 0.5 boundary and 1 at/above it", () => {
    // split=40, blendWidth=8 -> 0.5 at viewDist=36
    expect(cascadeFor(30, 40, 8)).toBe(0);
    expect(cascadeFor(35, 40, 8)).toBe(0);
    expect(cascadeFor(36, 40, 8)).toBe(1); // weight == 0.5 -> not < 0.5 -> far
    expect(cascadeFor(40, 40, 8)).toBe(1);
    expect(cascadeFor(50, 40, 8)).toBe(1);
  });

  it("returns 0 always when blendWidth <= 0 (low tier / single cascade)", () => {
    for (const d of [0, 10, 100, 1000]) {
      expect(cascadeFor(d, 40, 0)).toBe(0);
      expect(cascadeFor(d, 0, 0)).toBe(0);
      expect(cascadeFor(d, 40, -1)).toBe(0);
    }
  });

  it("never returns a value other than 0 or 1", () => {
    for (let d = 0; d <= 100; d += 1) {
      const c = cascadeFor(d, 40, 8);
      expect(c === 0 || c === 1).toBe(true);
    }
  });
});
