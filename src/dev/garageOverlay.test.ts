/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { KartDimensions } from "../kart/models/measure";
import { buildOverlay, type OverlayLine } from "./garageOverlay";

const DIMS: KartDimensions = {
  variant: "balanced",
  length: 2,
  width: 1.6,
  height: 1,
  wheelbase: 1.4,
  trackWidth: 1.2,
  rideHeight: 0.3,
  bounds: {
    min: { x: -0.8, y: 0, z: -1 },
    max: { x: 0.8, y: 1, z: 1 },
    size: { x: 1.6, y: 1, z: 2 },
  },
};

const PPM = 100;
const VP = { w: 800, h: 600 }; // center (400, 300)

/** A horizontal dimension line whose span (px) matches `meters * PPM`. */
function findHDim(lines: OverlayLine[], meters: number): OverlayLine | undefined {
  return lines.find(
    (l) =>
      l.role === "dim" && l.y1 === l.y2 && Math.abs(Math.abs(l.x2 - l.x1) - meters * PPM) < 1e-6,
  );
}

/** A vertical dimension line whose span (px) matches `meters * PPM`. */
function findVDim(lines: OverlayLine[], meters: number): OverlayLine | undefined {
  return lines.find(
    (l) =>
      l.role === "dim" && l.x1 === l.x2 && Math.abs(Math.abs(l.y2 - l.y1) - meters * PPM) < 1e-6,
  );
}

describe("garageOverlay.buildOverlay perspective/arbitrary", () => {
  it("draws nothing for iso, reariso, or an arbitrary orbit (axis null)", () => {
    for (const v of ["iso", "reariso", "az30el15"]) {
      const sc = buildOverlay(v, DIMS, 0, VP);
      expect(sc.lines).toHaveLength(0);
      expect(sc.labels).toHaveLength(0);
    }
  });
});

describe("garageOverlay.buildOverlay rear", () => {
  it("draws the front dimension set (width, height, track)", () => {
    const sc = buildOverlay("rear", DIMS, PPM, VP);
    const texts = sc.labels.map((l) => l.text);
    expect(texts).toContain("width 1.60 m");
    expect(texts).toContain("height 1.00 m");
    expect(texts).toContain("track 1.20 m");
    expect(findHDim(sc.lines, DIMS.width)).toBeDefined();
    expect(findVDim(sc.lines, DIMS.height)).toBeDefined();
  });
});

describe("garageOverlay.buildOverlay front", () => {
  const sc = buildOverlay("front", DIMS, PPM, VP);

  it("labels width, height, track, and the 1 m scale bar", () => {
    const texts = sc.labels.map((l) => l.text);
    expect(texts).toContain("width 1.60 m");
    expect(texts).toContain("height 1.00 m");
    expect(texts).toContain("track 1.20 m");
    expect(texts).toContain("1 m");
  });

  it("centers the width dimension line on the screen center x", () => {
    const width = findHDim(sc.lines, DIMS.width);
    expect(width).toBeDefined();
    expect((width!.x1 + width!.x2) / 2).toBeCloseTo(400, 9);
  });

  it("centers the height dimension line on the screen center y", () => {
    const height = findVDim(sc.lines, DIMS.height);
    expect(height).toBeDefined();
    expect((height!.y1 + height!.y2) / 2).toBeCloseTo(300, 9);
  });

  it("does not draw wheelbase (out-of-plane) in the front view", () => {
    expect(findHDim(sc.lines, DIMS.wheelbase)).toBeUndefined();
  });
});

describe("garageOverlay.buildOverlay side + top", () => {
  it("side draws length, height, wheelbase", () => {
    const sc = buildOverlay("side", DIMS, PPM, VP);
    const texts = sc.labels.map((l) => l.text);
    expect(texts).toContain("length 2.00 m");
    expect(texts).toContain("wheelbase 1.40 m");
    expect(findHDim(sc.lines, DIMS.length)).toBeDefined();
    expect(findHDim(sc.lines, DIMS.wheelbase)).toBeDefined();
    expect(findVDim(sc.lines, DIMS.height)).toBeDefined();
  });

  it("top draws width, length, track, wheelbase (both axle metrics)", () => {
    const sc = buildOverlay("top", DIMS, PPM, VP);
    const texts = sc.labels.map((l) => l.text);
    expect(texts).toContain("width 1.60 m");
    expect(texts).toContain("length 2.00 m");
    expect(texts).toContain("track 1.20 m");
    expect(texts).toContain("wheelbase 1.40 m");
    expect(findVDim(sc.lines, DIMS.length)).toBeDefined();
    expect(findVDim(sc.lines, DIMS.wheelbase)).toBeDefined();
  });
});
