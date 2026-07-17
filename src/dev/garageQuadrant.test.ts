/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { cellRect, parseRefGrid, QUADRANT_LAYOUT, quadrantRect } from "./garageQuadrant";

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

describe("garageQuadrant.cellRect", () => {
  it("agrees with quadrantRect for the 2x2 default (even + odd)", () => {
    for (const [v, r, c] of [
      ["front", 0, 0],
      ["side", 0, 1],
      ["iso", 1, 0],
      ["top", 1, 1],
    ] as const) {
      expect(cellRect(r, c, 2, 2, 101, 81)).toEqual(quadrantRect(v, 101, 81));
    }
  });

  it("tiles a 2x3 grid gap-free with odd remainder to later cells", () => {
    const cols = 3;
    const rects = [0, 1, 2].map((c) => cellRect(0, c, 2, cols, 100, 80));
    expect(rects.map((r) => r.sx)).toEqual([0, 33, 66]);
    expect(rects.map((r) => r.sw)).toEqual([33, 33, 34]); // widths sum to 100
    expect(rects[2]!.sx + rects[2]!.sw).toBe(100);
    // Bottom row starts at the vertical midpoint.
    expect(cellRect(1, 0, 2, cols, 100, 80).sy).toBe(40);
  });
});

describe("garageQuadrant.parseRefGrid", () => {
  it("parses a rows(/)-and-cells(,) layout into a cell map", () => {
    const g = parseRefGrid("front,side/top,rear")!;
    expect(g).toMatchObject({ rows: 2, cols: 2 });
    expect(g.map).toEqual({
      front: { row: 0, col: 0 },
      side: { row: 0, col: 1 },
      top: { row: 1, col: 0 },
      rear: { row: 1, col: 1 },
    });
  });

  it("skips blank cells and lowercases view ids", () => {
    const g = parseRefGrid("FRONT,,REAR")!;
    expect(g).toMatchObject({ rows: 1, cols: 3 });
    expect(g.map).toEqual({ front: { row: 0, col: 0 }, rear: { row: 0, col: 2 } });
  });

  it("returns null for empty/mapless input", () => {
    expect(parseRefGrid(null)).toBeNull();
    expect(parseRefGrid("")).toBeNull();
    expect(parseRefGrid(",/,")).toBeNull();
  });
});
