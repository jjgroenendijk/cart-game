import { describe, expect, it } from "vitest";
import { splitRects } from "./Renderer";

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
