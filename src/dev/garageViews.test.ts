/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { KartDimensions } from "../kart/models/measure";
import {
  GARAGE_VIEWS,
  boundsCenter,
  isGarageView,
  isoFraming,
  orthoFraming,
  planeExtents,
} from "./garageViews";

// Known dims: 1.6 m wide, 1 m tall, 2 m long, centered off-origin in Z.
const DIMS: KartDimensions = {
  variant: "balanced",
  length: 2,
  width: 1.6,
  height: 1,
  wheelbase: 1.4,
  trackWidth: 1.2,
  rideHeight: 0.3,
  bounds: {
    min: { x: -0.8, y: 0, z: -0.9 },
    max: { x: 0.8, y: 1, z: 1.1 },
    size: { x: 1.6, y: 1, z: 2 },
  },
};

const VP = { w: 800, h: 600 }; // aspect 4/3

describe("garageViews.isGarageView", () => {
  it("accepts the four named views and rejects anything else", () => {
    expect(GARAGE_VIEWS).toEqual(["front", "side", "top", "iso"]);
    for (const v of GARAGE_VIEWS) expect(isGarageView(v)).toBe(true);
    expect(isGarageView("rear")).toBe(false);
    expect(isGarageView(null)).toBe(false);
  });
});

describe("garageViews.planeExtents", () => {
  it("maps each ortho view to its in-plane bounds size", () => {
    expect(planeExtents("front", DIMS)).toEqual({ w: 1.6, h: 1 });
    expect(planeExtents("side", DIMS)).toEqual({ w: 2, h: 1 });
    expect(planeExtents("top", DIMS)).toEqual({ w: 1.6, h: 2 });
  });
});

describe("garageViews.orthoFraming", () => {
  it("pixelsPerMeter is exactly viewport.h / frustumHeight for every view", () => {
    for (const v of ["front", "side", "top"] as const) {
      const f = orthoFraming(v, DIMS, VP);
      expect(f.pixelsPerMeter * f.frustumHeight).toBeCloseTo(VP.h, 9);
      expect(f.frustumWidth).toBeCloseTo(f.frustumHeight * (VP.w / VP.h), 9);
    }
  });

  it("frames both in-plane extents inside the padded frustum", () => {
    for (const v of ["front", "side", "top"] as const) {
      const { w, h } = planeExtents(v, DIMS);
      const f = orthoFraming(v, DIMS, VP);
      // Padded extents fit (>= within float epsilon).
      expect(f.frustumWidth + 1e-9).toBeGreaterThanOrEqual(w * 1.2);
      expect(f.frustumHeight + 1e-9).toBeGreaterThanOrEqual(h * 1.2);
    }
  });

  it("front frustumHeight is limited by the padded width at 4/3 aspect", () => {
    // width-limited: 1.6*1.2 / (4/3) = 1.44 > 1*1.2 = 1.2.
    const f = orthoFraming("front", DIMS, VP);
    expect(f.frustumHeight).toBeCloseTo(1.44, 9);
    expect(f.pixelsPerMeter).toBeCloseTo(600 / 1.44, 6);
  });
});

describe("garageViews.isoFraming + boundsCenter", () => {
  it("returns a 3/4 angle and a positive framing distance", () => {
    const iso = isoFraming(DIMS);
    expect(iso.azimuth).toBeCloseTo((35 * Math.PI) / 180, 9);
    expect(iso.elevation).toBeCloseTo((25 * Math.PI) / 180, 9);
    expect(iso.distance).toBeGreaterThan(0);
    expect(Number.isFinite(iso.distance)).toBe(true);
  });

  it("boundsCenter averages the mesh bounds", () => {
    const c = boundsCenter(DIMS);
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(0.5, 9);
    expect(c.z).toBeCloseTo(0.1, 9);
  });
});
