import { describe, expect, it } from "vitest";
import {
  SKID_FADE_TIME,
  SKID_HALF_WIDTH,
  SKID_MIN_STEP,
  SKID_SEGMENTS,
  makeSkidRing,
  segmentCorners,
  shouldAppendSkid,
  skidFade,
  skidRingPush,
  type SkidSegment,
} from "./skidMarks";

function emptySeg(birth = 0): SkidSegment {
  return {
    birth,
    ax: 0,
    ay: 0,
    az: 0,
    bx: 0,
    by: 0,
    bz: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    dx: 0,
    dy: 0,
    dz: 0,
  };
}

describe("shouldAppendSkid", () => {
  it("is true only when drifting + grounded + moved > minStep", () => {
    expect(shouldAppendSkid(true, true, 1.0, SKID_MIN_STEP)).toBe(true);
  });

  it("is false when not drifting", () => {
    expect(shouldAppendSkid(false, true, 1.0, SKID_MIN_STEP)).toBe(false);
  });

  it("is false when not grounded (airborne)", () => {
    expect(shouldAppendSkid(true, false, 1.0, SKID_MIN_STEP)).toBe(false);
  });

  it("is false when movedDist <= minStep (dense-overlap guard)", () => {
    expect(shouldAppendSkid(true, true, SKID_MIN_STEP, SKID_MIN_STEP)).toBe(false);
    expect(shouldAppendSkid(true, true, 0, SKID_MIN_STEP)).toBe(false);
  });

  it("is true when movedDist strictly greater than minStep", () => {
    expect(shouldAppendSkid(true, true, SKID_MIN_STEP + 1e-6, SKID_MIN_STEP)).toBe(true);
  });
});

describe("segmentCorners", () => {
  // travel along +X (prev 0,0 -> curr 2,0); right = +Z (perpendicular in XZ).
  const seg = segmentCorners(0, 0, 2, 0, 0, 1, 0.5, emptySeg());

  it("sets Y components to 0 (GL owner bakes height)", () => {
    expect(seg.ay).toBe(0);
    expect(seg.by).toBe(0);
    expect(seg.cy).toBe(0);
    expect(seg.dy).toBe(0);
  });

  it("track width between the two sides = 2 * halfWidth", () => {
    const widthPrev = Math.hypot(seg.ax - seg.bx, seg.az - seg.bz);
    const widthCurr = Math.hypot(seg.cx - seg.dx, seg.cz - seg.dz);
    expect(widthPrev).toBeCloseTo(1.0, 6);
    expect(widthCurr).toBeCloseTo(1.0, 6);
  });

  it("corners are perpendicular to the travel direction", () => {
    // travel dir is +X; the prev-side a->b edge should be along Z (dot 0).
    const edgeX = seg.bx - seg.ax;
    const edgeZ = seg.bz - seg.az;
    expect(Math.abs(edgeX)).toBeCloseTo(0, 6);
    expect(Math.abs(edgeZ)).toBeCloseTo(1.0, 6);
  });

  it("the two diagonals share the travel midpoint (symmetric)", () => {
    const midADx = (seg.ax + seg.dx) / 2;
    const midADz = (seg.az + seg.dz) / 2;
    const midBCx = (seg.bx + seg.cx) / 2;
    const midBCz = (seg.bz + seg.cz) / 2;
    expect(midADx).toBeCloseTo(1, 6); // travel midpoint x
    expect(midADz).toBeCloseTo(0, 6);
    expect(midBCx).toBeCloseTo(midADx, 6);
    expect(midBCz).toBeCloseTo(midADz, 6);
  });

  it("left/right sides sit on the correct side of the right vector", () => {
    // right = +Z; left = center + right*half, right = center - right*half.
    expect(seg.az).toBeCloseTo(0.5, 6); // prev-left on +Z
    expect(seg.bz).toBeCloseTo(-0.5, 6); // prev-right on -Z
    expect(seg.cz).toBeCloseTo(0.5, 6); // curr-left on +Z
    expect(seg.dz).toBeCloseTo(-0.5, 6); // curr-right on -Z
  });

  it("mutates `out` in place and returns the same reference", () => {
    const out = emptySeg();
    const ret = segmentCorners(1, 1, 2, 2, 1, 0, SKID_HALF_WIDTH, out);
    expect(ret).toBe(out);
    expect(out.ax).not.toBe(0);
  });
});

describe("skidFade", () => {
  it("is 1 at age 0", () => {
    expect(skidFade(0, SKID_FADE_TIME)).toBe(1);
  });

  it("is 0 at age >= fadeTime", () => {
    expect(skidFade(SKID_FADE_TIME, SKID_FADE_TIME)).toBe(0);
    expect(skidFade(SKID_FADE_TIME + 1, SKID_FADE_TIME)).toBe(0);
  });

  it("is linear at the midpoint (age 3, fade 6 -> 0.5)", () => {
    expect(skidFade(3, SKID_FADE_TIME)).toBeCloseTo(0.5, 6);
  });

  it("clamps negative age to 1", () => {
    expect(skidFade(-2, SKID_FADE_TIME)).toBe(1);
  });

  it("is monotonic non-increasing", () => {
    let prev = 2;
    for (let a = 0; a <= SKID_FADE_TIME + 1; a += 0.5) {
      const f = skidFade(a, SKID_FADE_TIME);
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
    }
  });
});

describe("SkidRingCursor", () => {
  it("makeSkidRing sets capacity/head/count; clamps capacity < 1 to 1", () => {
    expect(makeSkidRing(3)).toEqual({ capacity: 3, head: 0, count: 0 });
    expect(makeSkidRing(0).capacity).toBe(1);
    expect(makeSkidRing(-2).capacity).toBe(1);
  });

  it("fills 0..N-1 then wraps; count caps at N; oldest overwritten first", () => {
    const cur = makeSkidRing(3);
    expect(skidRingPush(cur)).toBe(0);
    expect(skidRingPush(cur)).toBe(1);
    expect(skidRingPush(cur)).toBe(2);
    expect(cur).toEqual({ capacity: 3, head: 0, count: 3 });
    expect(skidRingPush(cur)).toBe(0); // oldest slot reused first
    expect(cur).toEqual({ capacity: 3, head: 1, count: 3 });
    expect(skidRingPush(cur)).toBe(1);
    expect(skidRingPush(cur)).toBe(2);
    expect(skidRingPush(cur)).toBe(0);
    expect(cur.count).toBe(3);
  });

  it("after N+M pushes head wraps and count stays at N", () => {
    const cur = makeSkidRing(4);
    for (let i = 0; i < 4 + 7; i++) skidRingPush(cur);
    expect(cur.count).toBe(4);
    expect(cur.head).toBe((4 + 7) % 4);
  });
});

describe("SKID_SEGMENTS (tier map)", () => {
  it("low=256, med=512, high=1024", () => {
    expect(SKID_SEGMENTS).toEqual({ low: 256, med: 512, high: 1024 });
  });
});
