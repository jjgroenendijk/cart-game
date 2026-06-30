import { describe, expect, it } from "vitest";
import { shadowCastsFromFade, splitRects } from "./Renderer";
import { DEFAULT_QUALITY } from "./quality";

describe("splitRects — single view", () => {
  it("n=1 returns one full-buffer rect", () => {
    expect(splitRects(800, 600, "horizontal", 1)).toEqual([{ x: 0, y: 0, w: 800, h: 600 }]);
  });

  it("n<=1 collapses to one full rect (defensive)", () => {
    expect(splitRects(800, 600, "vertical", 0)).toHaveLength(1);
  });
});

describe("splitRects — horizontal (top/bottom) 2-split", () => {
  const rects = splitRects(800, 600, "horizontal", 2);

  it("returns exactly two rects", () => {
    expect(rects).toHaveLength(2);
  });

  it("index 0 is the TOP half (WebGL bottom-origin: higher y)", () => {
    expect(rects[0]).toEqual({ x: 0, y: 300, w: 800, h: 300 });
  });

  it("index 1 is the BOTTOM half (y starts at 0)", () => {
    expect(rects[1]).toEqual({ x: 0, y: 0, w: 800, h: 300 });
  });

  it("the two halves tile the buffer with no gap or overlap", () => {
    const top = rects[0]!;
    const bot = rects[1]!;
    expect(top.h + bot.h).toBe(600);
    expect(top.y).toBe(bot.h); // top sits exactly above bottom
    expect(top.x).toBe(bot.x);
    expect(top.w).toBe(bot.w);
  });
});

describe("splitRects — vertical (side-by-side)", () => {
  it("2-split lays rects left then right", () => {
    const rects = splitRects(800, 600, "vertical", 2);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    expect(rects[1]).toEqual({ x: 400, y: 0, w: 400, h: 600 });
  });
});

describe("splitRects — determinism + tiling", () => {
  it("same args yield identical rects", () => {
    expect(splitRects(1280, 720, "horizontal", 2)).toEqual(splitRects(1280, 720, "horizontal", 2));
  });

  it("horizontal n-split stacks n equal rows that tile the full height", () => {
    for (const n of [2, 3, 4]) {
      const rects = splitRects(1000, 600, "horizontal", n);
      expect(rects).toHaveLength(n);
      const totalH = rects.reduce((sum, r) => sum + r.h, 0);
      expect(totalH).toBeCloseTo(600, 6);
      for (const r of rects) {
        expect(r.w).toBe(1000);
        expect(r.x).toBe(0);
      }
    }
  });

  it("rects are non-overlapping in y for a horizontal 3-split", () => {
    const rects = splitRects(900, 600, "horizontal", 3);
    const sorted = rects
      .map((r) => r.y)
      .slice()
      .sort((a, b) => a - b);
    // Each band is 200 tall; bottoms at 0, 200, 400.
    expect(sorted).toEqual([0, 200, 400]);
  });
});

describe("Renderer default quality", () => {
  // The Renderer class cannot be constructed under jsdom (needs WebGL), so
  // this only pins the default tier. The full no-regression vs the pre-011
  // hardcoded shadow look (map 2048, far 400, half 80, pixelRatio min(dpr,2))
  // lives in quality.test.ts next to the pure mapping.
  it("defaults to the high tier", () => {
    expect(DEFAULT_QUALITY).toBe("high");
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
