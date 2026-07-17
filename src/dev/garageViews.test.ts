/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import type { KartDimensions } from "../kart/models/measure";
import {
  GARAGE_VIEWS,
  PRESET_VIEWS,
  boundsCenter,
  frameExtents,
  isGarageView,
  isoFraming,
  orthoFraming,
  orthoPose,
  planeExtents,
  projectedExtents,
  resolveView,
  viewFraming,
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

describe("garageViews.isGarageView + resolveView", () => {
  it("keeps the canonical four as the default set and six presets in the panel", () => {
    expect(GARAGE_VIEWS).toEqual(["front", "side", "top", "iso"]);
    expect(PRESET_VIEWS).toEqual(["front", "side", "top", "rear", "iso", "reariso"]);
  });

  it("accepts presets, arbitrary orbits, and rejects junk", () => {
    for (const v of PRESET_VIEWS) expect(isGarageView(v)).toBe(true);
    expect(isGarageView("rear")).toBe(true);
    expect(isGarageView("az30el15")).toBe(true);
    expect(isGarageView("az45el-10o")).toBe(true);
    expect(isGarageView("bogus")).toBe(false);
    expect(isGarageView(null)).toBe(false);
  });

  it("resolves presets with the right projection, governing dim, and axis", () => {
    expect(resolveView("rear")).toMatchObject({
      ortho: true,
      govern: "width",
      axis: "front",
    });
    expect(resolveView("reariso")).toMatchObject({
      ortho: false,
      govern: null,
      axis: null,
    });
    expect(resolveView("REAR")?.id).toBe("rear"); // case-insensitive
  });

  it("resolves an arbitrary orbit token to degrees, perspective by default", () => {
    const v = resolveView("az30el15")!;
    expect(v.ortho).toBe(false);
    expect(v.govern).toBeNull();
    expect(v.axis).toBeNull();
    expect(v.azimuth).toBeCloseTo((30 * Math.PI) / 180, 9);
    expect(v.elevation).toBeCloseTo((15 * Math.PI) / 180, 9);
  });

  it("honors the ortho suffix and clamps elevation to +/-89deg", () => {
    expect(resolveView("az45el-10o")?.ortho).toBe(true);
    expect(resolveView("az0el120")?.elevation).toBeCloseTo((89 * Math.PI) / 180, 9);
    expect(resolveView("az0el-120")?.elevation).toBeCloseTo((-89 * Math.PI) / 180, 9);
  });
});

describe("garageViews.projectedExtents + frameExtents", () => {
  it("reproduces planeExtents for the axis-aligned presets", () => {
    const half = Math.PI / 2;
    expect(projectedExtents(0, 0, DIMS)).toMatchObject({ w: 1.6, h: 1 }); // front
    expect(projectedExtents(half, 0, DIMS).w).toBeCloseTo(2, 9); // side sees Z
    expect(projectedExtents(half, 0, DIMS).h).toBeCloseTo(1, 9);
    expect(projectedExtents(0, half, DIMS).w).toBeCloseTo(1.6, 9); // top sees X/Z
    expect(projectedExtents(0, half, DIMS).h).toBeCloseTo(2, 9);
  });

  it("frameExtents matches orthoFraming for a preset's plane extents", () => {
    const { w, h } = planeExtents("front", DIMS);
    expect(frameExtents(w, h, VP)).toEqual(orthoFraming("front", DIMS, VP));
  });

  it("viewFraming routes presets through orthoFraming, arbitrary through projected", () => {
    expect(viewFraming(resolveView("front")!, DIMS, VP)).toEqual(orthoFraming("front", DIMS, VP));
    const arb = resolveView("az30el15o")!;
    const pe = projectedExtents(arb.azimuth, arb.elevation, DIMS);
    expect(viewFraming(arb, DIMS, VP)).toEqual(frameExtents(pe.w, pe.h, VP));
  });
});

describe("garageViews.orthoPose", () => {
  it("keeps the legacy exact vectors for the axis-aligned presets", () => {
    expect(orthoPose(resolveView("front")!)).toEqual({
      up: { x: 0, y: 1, z: 0 },
      eye: { x: 0, y: 0, z: 1 },
    });
    expect(orthoPose(resolveView("side")!)).toEqual({
      up: { x: 0, y: 1, z: 0 },
      eye: { x: 1, y: 0, z: 0 },
    });
    expect(orthoPose(resolveView("top")!)).toEqual({
      up: { x: 0, y: 0, z: -1 },
      eye: { x: 0, y: 1, z: 0 },
    });
  });

  it("mirrors front to +Z for rear and derives arbitrary from the orbit", () => {
    expect(orthoPose(resolveView("rear")!)).toEqual({
      up: { x: 0, y: 1, z: 0 },
      eye: { x: 0, y: 0, z: -1 },
    });
    const arb = orthoPose(resolveView("az90el0o")!);
    expect(arb.eye.x).toBeCloseTo(1, 9); // az 90 -> +X
    expect(arb.up).toEqual({ x: 0, y: 1, z: 0 });
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
