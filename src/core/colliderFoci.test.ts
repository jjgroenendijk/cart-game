import { describe, expect, it } from "vitest";
import { fillKartFoci } from "./colliderFoci";
import type { Pt } from "../kart/kartLod";
import type { PlayerView } from "./PlayerView";
import type { Kart } from "../kart/Kart";

// Minimal structural stand-ins: fillKartFoci only reads .kart.group.position
// (views) and .group.position (rivals). Cast through unknown so the test needs
// no WebGL/Three kart construction.
function view(x: number, y: number, z: number): PlayerView {
  return { kart: { group: { position: { x, y, z } } } } as unknown as PlayerView;
}
function rival(x: number, y: number, z: number): Kart {
  return { group: { position: { x, y, z } } } as unknown as Kart;
}

describe("fillKartFoci (202 collider foci pool)", () => {
  it("writes human views then rivals in order", () => {
    const out: Pt[] = [];
    const r = fillKartFoci(out, [view(1, 2, 3)], [rival(4, 5, 6)]);
    expect(r).toBe(out); // returns the same pool
    expect(out).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
  });

  it("reuses pooled slots and truncates when the kart count shrinks", () => {
    const out: Pt[] = [];
    fillKartFoci(out, [view(1, 1, 1), view(2, 2, 2)], [rival(3, 3, 3)]);
    const firstSlot = out[0];
    fillKartFoci(out, [view(9, 9, 9)], []); // fewer karts this frame
    expect(out.length).toBe(1);
    expect(out[0]).toBe(firstSlot); // same object mutated, not reallocated
    expect(out[0]).toEqual({ x: 9, y: 9, z: 9 });
  });

  it("returns an empty pool when there are no karts", () => {
    const out: Pt[] = [{ x: 7, y: 7, z: 7 }];
    fillKartFoci(out, [], []);
    expect(out.length).toBe(0);
  });
});
