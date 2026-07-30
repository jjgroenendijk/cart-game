import { describe, expect, it } from "vitest";
import { FOG_EDGE_MARGIN, scaleFogToWorld, shadowCastsFromFade } from "./Renderer";
import { DEFAULT_QUALITY } from "./quality";

describe("Renderer default quality", () => {
  // The Renderer class cannot be constructed under jsdom (needs WebGL), so
  // this only pins the default tier. The full no-regression vs the pre-011
  // hardcoded shadow look (map 2048, far 400, half 80, pixelRatio min(dpr,2))
  // lives in quality.test.ts next to the pure mapping.
  it("defaults to the high tier", () => {
    expect(DEFAULT_QUALITY).toBe("high");
  });
});

describe("scaleFogToWorld", () => {
  it("Infinity extent (unset) is a passthrough", () => {
    expect(scaleFogToWorld(90, 360, Infinity)).toEqual({ near: 90, far: 360 });
  });

  it("does not touch fog when the world is larger than fog far", () => {
    // world half 384 (worldSize 768) at margin 1.0 -> cap 384 > 360, no clamp.
    expect(scaleFogToWorld(90, 360, 384)).toEqual({ near: 90, far: 360 });
  });

  it("caps far to the world and scales near by the same factor", () => {
    // world half 180 < 360 -> cap 180, s = 0.5 -> near halves too.
    expect(scaleFogToWorld(90, 360, 180)).toEqual({ near: 45, far: 180 });
  });

  it("preserves the near/far ratio when clamped", () => {
    const { near, far } = scaleFogToWorld(90, 360, 100);
    expect(near / far).toBeCloseTo(90 / 360, 6);
    expect(far).toBe(100);
  });

  it("honors a margin below 1 (hides a ring of edge terrain)", () => {
    expect(scaleFogToWorld(100, 400, 200, 0.9)).toEqual({ near: 45, far: 180 });
  });

  it("default margin is 1.0 (fog end sits at the world boundary)", () => {
    expect(FOG_EDGE_MARGIN).toBe(1.0);
  });
});

describe("shadowCastsFromFade", () => {
  it("is false at fade 0 (shadow map off in deep night)", () => {
    expect(shadowCastsFromFade(0)).toBe(false);
  });
  it("is true for any positive fade (map alive across the band)", () => {
    expect(shadowCastsFromFade(0.001)).toBe(true);
    expect(shadowCastsFromFade(0.5)).toBe(true);
    expect(shadowCastsFromFade(1)).toBe(true);
  });
});
