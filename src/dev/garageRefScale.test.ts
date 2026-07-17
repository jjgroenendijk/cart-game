/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { Mask, MaskBounds } from "./garageMask";
import { refGoverningMeters, refPlacement, resampleMask } from "./garageRefScale";

/** Inclusive bbox helper. */
function box(minX: number, minY: number, maxX: number, maxY: number): MaskBounds {
  return { minX, minY, maxX, maxY, empty: false };
}

const REAL = { length: 3.9, width: 1.78, height: 1.38 };

describe("garageRefScale.refGoverningMeters", () => {
  it("uses each view's horizontal real dimension", () => {
    expect(refGoverningMeters("front", REAL)).toBe(1.78); // width
    expect(refGoverningMeters("side", REAL)).toBe(3.9); // length
    expect(refGoverningMeters("top", REAL)).toBe(1.78); // width
    expect(refGoverningMeters("rear", REAL)).toBe(1.78); // width
    expect(refGoverningMeters("iso", REAL)).toBeNull(); // proportional
    expect(refGoverningMeters("reariso", REAL)).toBeNull();
    expect(refGoverningMeters("az30el15", REAL)).toBeNull(); // arbitrary never metric
  });

  it("honors an override and rejects missing/zero dims", () => {
    expect(refGoverningMeters("top", REAL, { top: "length" })).toBe(3.9);
    expect(refGoverningMeters("front", { width: 0 })).toBeNull();
    expect(refGoverningMeters("side", {})).toBeNull();
  });
});

describe("garageRefScale.refPlacement", () => {
  it("scales a metric view so the governing span hits governMeters * ppm", () => {
    const ref = box(0, 0, 9, 9); // spanX 10
    const model = box(0, 0, 99, 99); // spanX 100, bottom 99
    const p = refPlacement("front", ref, model, 50, 2); // target 100 px
    expect(p.metric).toBe(true);
    expect(p.scale).toBeCloseTo(10, 9); // 100 / 10
    expect(p.dx).toBeCloseTo(0, 9); // centers: 50 - 5*10
    expect(p.dy).toBeCloseTo(0, 9); // ground-aligned: 100 - 10*10
  });

  it("rear is metric (width-governed) and ground-aligned like front", () => {
    const ref = box(0, 0, 9, 9); // spanX 10
    const model = box(0, 0, 99, 99); // spanX 100, bottom 99
    const p = refPlacement("rear", ref, model, 50, 2); // target 100 px
    expect(p.metric).toBe(true);
    expect(p.scale).toBeCloseTo(10, 9);
    expect(p.dy).toBeCloseTo(0, 9); // ground-aligned: 100 - 10*10
  });

  it("an arbitrary orbit is never metric (proportional fit)", () => {
    const ref = box(0, 0, 9, 19); // spanX 10, spanY 20
    const model = box(0, 0, 99, 99);
    const p = refPlacement("az30el15", ref, model, 50, 2);
    expect(p.metric).toBe(false);
    expect(p.scale).toBeCloseTo(5, 9); // min(100/10, 100/20)
  });

  it("fits the bbox proportionally for iso (non-metric)", () => {
    const ref = box(0, 0, 9, 19); // spanX 10, spanY 20
    const model = box(0, 0, 99, 99); // spanX 100, spanY 100
    const p = refPlacement("iso", ref, model, null, null);
    expect(p.metric).toBe(false);
    expect(p.scale).toBeCloseTo(5, 9); // min(100/10, 100/20)
  });

  it("returns identity when either bbox is empty", () => {
    const empty: MaskBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };
    expect(refPlacement("front", empty, box(0, 0, 9, 9), 50, 2).scale).toBe(1);
  });
});

describe("garageRefScale.resampleMask", () => {
  function mask(w: number, h: number, on: Array<[number, number]>): Mask {
    const data = new Uint8Array(w * h);
    for (const [x, y] of on) data[y * w + x] = 1;
    return { data, w, h };
  }

  it("is the identity at scale 1 with no offset", () => {
    const src = mask(3, 3, [
      [1, 1],
      [2, 0],
    ]);
    const out = resampleMask(src, { scale: 1, dx: 0, dy: 0, metric: true }, 3, 3);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it("upscales 2x by nearest neighbor into a block", () => {
    const src = mask(2, 2, [[1, 1]]);
    const out = resampleMask(src, { scale: 2, dx: 0, dy: 0, metric: false }, 4, 4);
    let count = 0;
    for (const v of out.data) count += v;
    expect(count).toBe(4); // src (1,1) covers out (2..3, 2..3)
    for (const [x, y] of [
      [2, 2],
      [3, 3],
    ]) {
      expect(out.data[y * 4 + x]).toBe(1);
    }
  });
});
