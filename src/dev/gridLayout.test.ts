/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { gridShape, parseViewsParam, tileRects } from "./gridLayout";
import { GARAGE_VIEWS, type GarageView } from "./garageViews";

describe("gridLayout.gridShape", () => {
  it("is near-square with columns favored", () => {
    expect(gridShape(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(3)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(6)).toEqual({ cols: 3, rows: 2 });
  });

  it("clamps non-positive counts to a single cell", () => {
    expect(gridShape(0)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(-3)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("gridLayout.tileRects", () => {
  it("lays views row-major into equal cells with a top-left origin", () => {
    const rects = tileRects(["front", "side", "top", "iso"], { w: 800, h: 600 });
    expect(rects).toEqual([
      { view: "front", x: 0, y: 0, w: 400, h: 300 },
      { view: "side", x: 400, y: 0, w: 400, h: 300 },
      { view: "top", x: 0, y: 300, w: 400, h: 300 },
      { view: "iso", x: 400, y: 300, w: 400, h: 300 },
    ]);
  });

  it("tiles cover the canvas without overlap for the full set", () => {
    const size = { w: 1280, h: 720 };
    const rects = tileRects([...GARAGE_VIEWS], size);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    // 4 tiles in a 2x2 grid exactly cover the canvas.
    expect(area).toBeCloseTo(size.w * size.h, 6);
  });

  it("returns nothing for an empty view list", () => {
    expect(tileRects([], { w: 800, h: 600 })).toEqual([]);
  });
});

describe("gridLayout.parseViewsParam", () => {
  it("defaults to the full set when absent", () => {
    expect(parseViewsParam(null)).toEqual([...GARAGE_VIEWS]);
  });

  it("keeps a validated, de-duplicated subset in order", () => {
    expect(parseViewsParam("front,side")).toEqual<GarageView[]>(["front", "side"]);
    expect(parseViewsParam("TOP, iso")).toEqual<GarageView[]>(["top", "iso"]);
    expect(parseViewsParam("front,front,side")).toEqual<GarageView[]>(["front", "side"]);
  });

  it("falls back to the full set when nothing valid is given", () => {
    expect(parseViewsParam("bogus,rear")).toEqual([...GARAGE_VIEWS]);
    expect(parseViewsParam("")).toEqual([...GARAGE_VIEWS]);
  });
});
