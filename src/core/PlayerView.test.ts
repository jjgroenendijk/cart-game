import { describe, expect, it } from "vitest";
import { viewHudAnchor, type CssPoint } from "./PlayerView";
import type { Rect } from "./Renderer";

const SW = 800;
const SH = 600;
const TOP_HALF: Rect = { x: 0, y: 300, w: 800, h: 300 }; // WebGL bottom-origin
const BOTTOM_HALF: Rect = { x: 0, y: 0, w: 800, h: 300 };

describe("viewHudAnchor — top-left corner (HUD anchor)", () => {
  it("maps a top-half rect to screen-top CSS (left 0, top 0)", () => {
    expect(viewHudAnchor(TOP_HALF, "top-left", SW, SH)).toEqual<CssPoint>({
      left: 0,
      top: 0,
    });
  });

  it("maps a bottom-half rect to mid-screen CSS (left 0, top 300)", () => {
    expect(viewHudAnchor(BOTTOM_HALF, "top-left", SW, SH)).toEqual<CssPoint>({
      left: 0,
      top: 300,
    });
  });
});

describe("viewHudAnchor — every corner", () => {
  it("top-right of the top half is at the top-right screen corner", () => {
    expect(viewHudAnchor(TOP_HALF, "top-right", SW, SH)).toEqual({ left: 800, top: 0 });
  });

  it("bottom-left of the bottom half is at the bottom-left screen corner", () => {
    expect(viewHudAnchor(BOTTOM_HALF, "bottom-left", SW, SH)).toEqual({ left: 0, top: 600 });
  });

  it("bottom-right of the top half sits on the horizontal seam (top 300)", () => {
    expect(viewHudAnchor(TOP_HALF, "bottom-right", SW, SH)).toEqual({ left: 800, top: 300 });
  });
});

describe("viewHudAnchor — clamping", () => {
  it("clamps a corner past the right edge into the screen", () => {
    const wide: Rect = { x: 0, y: 300, w: 9999, h: 300 };
    const p = viewHudAnchor(wide, "top-right", SW, SH);
    expect(p.left).toBe(SW);
  });

  it("clamps a corner past the bottom edge into the screen", () => {
    // A rect whose CSS bottom would exceed the screen height.
    const tall: Rect = { x: 0, y: 0, w: 800, h: 9999 };
    const p = viewHudAnchor(tall, "bottom-left", SW, SH);
    expect(p.top).toBe(SH);
  });

  it("never returns a point outside [0,screenW] x [0,screenH]", () => {
    const rects = [TOP_HALF, BOTTOM_HALF];
    const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
    for (const r of rects) {
      for (const c of corners) {
        const p = viewHudAnchor(r, c, SW, SH);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left).toBeLessThanOrEqual(SW);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeLessThanOrEqual(SH);
      }
    }
  });
});
