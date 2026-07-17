/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { QUADRANT_LAYOUT, quadrantRect } from "./garageQuadrant";

describe("garageQuadrant.QUADRANT_LAYOUT", () => {
  it("maps views to the agreed 2x2 cells (TL front, TR side, BL iso, BR top)", () => {
    expect(QUADRANT_LAYOUT.front).toEqual({ row: 0, col: 0 });
    expect(QUADRANT_LAYOUT.side).toEqual({ row: 0, col: 1 });
    expect(QUADRANT_LAYOUT.iso).toEqual({ row: 1, col: 0 });
    expect(QUADRANT_LAYOUT.top).toEqual({ row: 1, col: 1 });
  });
});

describe("garageQuadrant.quadrantRect", () => {
  it("splits an even image into four equal quadrants", () => {
    expect(quadrantRect("front", 100, 80)).toEqual({ sx: 0, sy: 0, sw: 50, sh: 40 });
    expect(quadrantRect("side", 100, 80)).toEqual({ sx: 50, sy: 0, sw: 50, sh: 40 });
    expect(quadrantRect("iso", 100, 80)).toEqual({ sx: 0, sy: 40, sw: 50, sh: 40 });
    expect(quadrantRect("top", 100, 80)).toEqual({ sx: 50, sy: 40, sw: 50, sh: 40 });
  });

  it("tiles an odd image with no gap or overlap (remainder to right/bottom cells)", () => {
    const views = ["front", "side", "iso", "top"] as const;
    const rects = views.map((v) => quadrantRect(v, 101, 81));
    // Right column reaches the right edge; bottom row reaches the bottom edge.
    for (const v of ["side", "top"] as const) {
      const r = quadrantRect(v, 101, 81);
      expect(r.sx + r.sw).toBe(101);
    }
    for (const v of ["iso", "top"] as const) {
      const r = quadrantRect(v, 101, 81);
      expect(r.sy + r.sh).toBe(81);
    }
    // Left/top cells start at the origin with the floored midpoint size.
    expect(rects[0]).toEqual({ sx: 0, sy: 0, sw: 50, sh: 40 });
  });
});
