/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  type Mask,
  backgroundMask,
  classifyDiff,
  diffStats,
  estimateBackground,
  luminanceMask,
  maskBounds,
  paintDiff,
  DEFAULT_DIFF_PALETTE,
} from "./garageMask";

/** Build an RGBA buffer from a per-pixel color function. */
function rgba(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/** Build a Mask from a per-pixel predicate. */
function mask(w: number, h: number, fn: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = fn(x, y) ? 1 : 0;
  }
  return { data, w, h };
}

describe("garageMask.luminanceMask", () => {
  it("keeps bright pixels and drops near-black on a white-on-black render", () => {
    const buf = rgba(2, 2, (x, y) => (x === 0 && y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const m = luminanceMask(buf, 2, 2);
    expect(Array.from(m.data)).toEqual([1, 0, 0, 0]);
  });

  it("honors a custom threshold", () => {
    const buf = rgba(1, 1, () => [30, 30, 30, 255]); // luma 30
    expect(luminanceMask(buf, 1, 1, { threshold: 20 }).data[0]).toBe(1);
    expect(luminanceMask(buf, 1, 1, { threshold: 40 }).data[0]).toBe(0);
  });
});

describe("garageMask.estimateBackground", () => {
  it("takes the per-channel median of the four corners, ignoring one outlier", () => {
    // 3x3: three white corners, one black corner, colored center.
    const buf = rgba(3, 3, (x, y) => {
      if (x === 2 && y === 2) return [0, 0, 0, 255];
      if ((x === 0 || x === 2) && (y === 0 || y === 2)) return [255, 255, 255, 255];
      return [10, 200, 50, 255];
    });
    expect(estimateBackground(buf, 3, 3)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("garageMask.backgroundMask", () => {
  const bg = { r: 255, g: 255, b: 255 };
  it("keys out the background but keeps distinct foreground", () => {
    const buf = rgba(3, 1, (x) => {
      if (x === 0) return [255, 255, 255, 255]; // exact bg -> out
      if (x === 1) return [250, 250, 250, 255]; // near-white dist 15 < 40 -> out
      return [80, 80, 80, 255]; // dark car dist 525 > 40 -> in
    });
    expect(Array.from(backgroundMask(buf, 3, 1, bg).data)).toEqual([0, 0, 1]);
  });

  it("treats transparent pixels as background regardless of color", () => {
    const buf = rgba(1, 1, () => [10, 20, 30, 0]);
    expect(backgroundMask(buf, 1, 1, bg).data[0]).toBe(0);
  });
});

describe("garageMask.maskBounds", () => {
  it("finds the tight box of a filled region", () => {
    const m = mask(5, 4, (x, y) => x >= 1 && x <= 3 && y >= 1 && y <= 2);
    expect(maskBounds(m)).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 2, empty: false });
  });

  it("reports empty for a blank mask", () => {
    expect(maskBounds(mask(3, 3, () => false)).empty).toBe(true);
  });
});

describe("garageMask.classifyDiff", () => {
  it("counts overlap / model-only / ref-only for offset squares", () => {
    const model = mask(4, 4, (x) => x <= 1); // cols 0,1
    const ref = mask(4, 4, (x) => x >= 1 && x <= 2); // cols 1,2
    const d = classifyDiff(model, ref);
    expect(d.overlap).toBe(4); // col 1
    expect(d.modelOnly).toBe(4); // col 0
    expect(d.refOnly).toBe(4); // col 2
    expect(d.modelTotal).toBe(8);
    expect(d.refTotal).toBe(8);
  });

  it("throws on a size mismatch", () => {
    expect(() =>
      classifyDiff(
        mask(2, 2, () => true),
        mask(3, 3, () => true),
      ),
    ).toThrow();
  });
});

describe("garageMask.diffStats", () => {
  it("derives percent-of-union, IoU, and coverage", () => {
    const model = mask(4, 4, (x) => x <= 1);
    const ref = mask(4, 4, (x) => x >= 1 && x <= 2);
    const s = diffStats(classifyDiff(model, ref));
    expect(s.iou).toBeCloseTo(0.3333, 4); // 4 / 12
    expect(s.modelOnlyPct).toBeCloseTo(33.33, 2);
    expect(s.refOnlyPct).toBeCloseTo(33.33, 2);
    expect(s.coverage).toBeCloseTo(0.75, 4); // 12 / 16
  });

  it("returns zeros for two empty masks", () => {
    const s = diffStats(
      classifyDiff(
        mask(2, 2, () => false),
        mask(2, 2, () => false),
      ),
    );
    expect(s).toEqual({ modelOnlyPct: 0, refOnlyPct: 0, iou: 0, coverage: 0 });
  });
});

describe("garageMask.paintDiff", () => {
  it("tints each class and leaves none transparent", () => {
    const model = mask(3, 1, (x) => x <= 1); // cols 0,1
    const ref = mask(3, 1, (x) => x >= 1); // cols 1,2
    const rgbaOut = paintDiff(classifyDiff(model, ref), DEFAULT_DIFF_PALETTE, 0.6);
    const px = (i: number): number[] => Array.from(rgbaOut.slice(i * 4, i * 4 + 4));
    expect(px(0)).toEqual([0, 220, 220, 153]); // model-only cyan, alpha 0.6*255
    expect(px(1)).toEqual([120, 120, 128, 153]); // overlap gray
    expect(px(2)).toEqual([230, 0, 200, 153]); // ref-only magenta
  });
});
