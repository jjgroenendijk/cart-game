/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { GarageView } from "./garageViews";
import { contactSheetLayout, parseViews, type PanelLayout } from "./garageContactSheet";

const CELL = { w: 100, h: 80 };
const OPTS = { gap: 8, labelH: 20 };

/** True when two render rects overlap (touching edges are allowed). */
function overlaps(a: PanelLayout, b: PanelLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("garageContactSheet.contactSheetLayout", () => {
  it("lays a single view into one column", () => {
    const s = contactSheetLayout(["side"], CELL, OPTS);
    expect(s.panels).toHaveLength(1);
    expect(s).toMatchObject({ width: 100, height: 100 });
    expect(s.panels[0]).toEqual({ view: "side", x: 0, y: 20, w: 100, h: 80 });
  });

  it("lays two views into one row of two", () => {
    const s = contactSheetLayout(["front", "side"], CELL, OPTS);
    expect(s).toMatchObject({ width: 208, height: 100 });
    expect(s.panels.map((p) => p.x)).toEqual([0, 108]);
    expect(s.panels.every((p) => p.y === 20)).toBe(true);
  });

  it("mirrors the reference 2x2 for the full four-view set, regardless of order", () => {
    const order: GarageView[] = ["top", "iso", "side", "front"];
    const s = contactSheetLayout(order, CELL, OPTS);
    expect(s).toMatchObject({ width: 208, height: 208 });
    const at = (v: GarageView): PanelLayout => s.panels.find((p) => p.view === v)!;
    expect(at("front")).toMatchObject({ x: 0, y: 20 }); // TL
    expect(at("side")).toMatchObject({ x: 108, y: 20 }); // TR
    expect(at("iso")).toMatchObject({ x: 0, y: 128 }); // BL
    expect(at("top")).toMatchObject({ x: 108, y: 128 }); // BR
  });

  it("produces non-overlapping panels", () => {
    const s = contactSheetLayout(["front", "side", "top", "iso"], CELL, OPTS);
    for (let i = 0; i < s.panels.length; i++) {
      for (let j = i + 1; j < s.panels.length; j++) {
        expect(overlaps(s.panels[i]!, s.panels[j]!)).toBe(false);
      }
    }
  });

  it("returns an empty sheet for no views", () => {
    expect(contactSheetLayout([], CELL, OPTS)).toEqual({ width: 0, height: 0, panels: [] });
  });
});

describe("garageContactSheet.parseViews", () => {
  it("defaults to all four views in order when empty/blank/unknown", () => {
    expect(parseViews(null)).toEqual(["front", "side", "top", "iso"]);
    expect(parseViews("")).toEqual(["front", "side", "top", "iso"]);
    expect(parseViews("bogus")).toEqual(["front", "side", "top", "iso"]);
  });

  it("keeps known views in given order and drops duplicates/unknowns", () => {
    expect(parseViews("side, front")).toEqual(["side", "front"]);
    expect(parseViews("side,bogus,side")).toEqual(["side"]);
  });
});
