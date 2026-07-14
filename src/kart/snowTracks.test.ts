import { describe, expect, it } from "vitest";
import {
  TRACK_BERM_LIFT,
  TRACK_CHANNEL_LIFT,
  TRACK_FADE_TIME,
  TRACK_HALF_WIDTH,
  TRACK_MIN_FADE,
  TRACK_MIN_STEP,
  TRACK_SEGMENTS,
  makeTrackRing,
  shouldAppendTrack,
  trackFade,
  trackFadeTime,
  trackOnSnow,
  trackProfileCorners,
  trackRingPush,
  type TrackSegment,
} from "./snowTracks";

function emptySeg(birth = 0): TrackSegment {
  return {
    birth,
    plx: 0,
    ply: 0,
    plz: 0,
    pcx: 0,
    pcy: 0,
    pcz: 0,
    prx: 0,
    pry: 0,
    prz: 0,
    clx: 0,
    cly: 0,
    clz: 0,
    ccx: 0,
    ccy: 0,
    ccz: 0,
    crx: 0,
    cry: 0,
    crz: 0,
  };
}

describe("shouldAppendTrack", () => {
  it("is true only when onSnow + grounded + not in water + moved >= minStep", () => {
    expect(shouldAppendTrack(true, true, false, 1.0, TRACK_MIN_STEP)).toBe(true);
  });

  it("is false when not on snow", () => {
    expect(shouldAppendTrack(false, true, false, 1.0, TRACK_MIN_STEP)).toBe(false);
  });

  it("is false when not grounded (airborne)", () => {
    expect(shouldAppendTrack(true, false, false, 1.0, TRACK_MIN_STEP)).toBe(false);
  });

  it("is false when in water", () => {
    expect(shouldAppendTrack(true, true, true, 1.0, TRACK_MIN_STEP)).toBe(false);
  });

  it("is false when movedDist < minStep (dense-overlap guard)", () => {
    expect(shouldAppendTrack(true, true, false, TRACK_MIN_STEP - 1e-6, TRACK_MIN_STEP)).toBe(false);
    expect(shouldAppendTrack(true, true, false, 0, TRACK_MIN_STEP)).toBe(false);
  });

  it("is true at exactly minStep (>= gate)", () => {
    expect(shouldAppendTrack(true, true, false, TRACK_MIN_STEP, TRACK_MIN_STEP)).toBe(true);
  });
});

describe("trackOnSnow", () => {
  it("is true when eased cover exceeds the threshold (snowy weather)", () => {
    expect(trackOnSnow(0.5, 0.1, 0.2, 0.05)).toBe(true);
  });

  it("is true on a near-white desaturated tint even at zero cover (tundra)", () => {
    expect(trackOnSnow(0, 0.82, 0.85, 0.9)).toBe(true);
  });

  it("is false on bare dark/saturated ground with no cover", () => {
    expect(trackOnSnow(0, 0.3, 0.18, 0.08)).toBe(false);
    expect(trackOnSnow(0, 0.9, 0.4, 0.1)).toBe(false); // bright but saturated
  });
});

describe("trackProfileCorners", () => {
  // travel along +X (prev 0,0 -> curr 2,0); right = +Z (perpendicular in XZ).
  const seg = trackProfileCorners(
    0,
    0,
    2,
    0,
    0,
    1,
    TRACK_HALF_WIDTH,
    TRACK_BERM_LIFT,
    TRACK_CHANNEL_LIFT,
    emptySeg(),
  );

  it("lifts the outer berms above the sunken center channel", () => {
    expect(seg.ply).toBe(TRACK_BERM_LIFT);
    expect(seg.pry).toBe(TRACK_BERM_LIFT);
    expect(seg.cly).toBe(TRACK_BERM_LIFT);
    expect(seg.cry).toBe(TRACK_BERM_LIFT);
    expect(seg.pcy).toBe(TRACK_CHANNEL_LIFT);
    expect(seg.ccy).toBe(TRACK_CHANNEL_LIFT);
    expect(TRACK_BERM_LIFT).toBeGreaterThan(TRACK_CHANNEL_LIFT);
  });

  it("places the channel between the two berms (correct lateral layout)", () => {
    // right = +Z: left berm on +Z, right berm on -Z, channel on the travel line.
    expect(seg.plz).toBeCloseTo(TRACK_HALF_WIDTH, 6);
    expect(seg.prz).toBeCloseTo(-TRACK_HALF_WIDTH, 6);
    expect(seg.pcz).toBeCloseTo(0, 6);
  });

  it("full track width across the berms = 2 * halfWidth", () => {
    const widthPrev = Math.hypot(seg.plx - seg.prx, seg.plz - seg.prz);
    const widthCurr = Math.hypot(seg.clx - seg.crx, seg.clz - seg.crz);
    expect(widthPrev).toBeCloseTo(2 * TRACK_HALF_WIDTH, 6);
    expect(widthCurr).toBeCloseTo(2 * TRACK_HALF_WIDTH, 6);
  });

  it("each half (berm -> channel) spans exactly halfWidth", () => {
    const leftHalf = Math.hypot(seg.plx - seg.pcx, seg.plz - seg.pcz);
    const rightHalf = Math.hypot(seg.pcx - seg.prx, seg.pcz - seg.prz);
    expect(leftHalf).toBeCloseTo(TRACK_HALF_WIDTH, 6);
    expect(rightHalf).toBeCloseTo(TRACK_HALF_WIDTH, 6);
  });

  it("channel rails ride the wheel center line (prev 0, curr 2 in x)", () => {
    expect(seg.pcx).toBeCloseTo(0, 6);
    expect(seg.pcz).toBeCloseTo(0, 6);
    expect(seg.ccx).toBeCloseTo(2, 6);
    expect(seg.ccz).toBeCloseTo(0, 6);
  });

  it("mutates `out` in place and returns the same reference", () => {
    const out = emptySeg();
    const ret = trackProfileCorners(
      1,
      1,
      2,
      2,
      1,
      0,
      TRACK_HALF_WIDTH,
      TRACK_BERM_LIFT,
      TRACK_CHANNEL_LIFT,
      out,
    );
    expect(ret).toBe(out);
    expect(out.plx).not.toBe(0);
  });
});

describe("trackFadeTime", () => {
  it("returns exactly baseFade at zero snowfall (tracks stay long)", () => {
    expect(trackFadeTime(TRACK_FADE_TIME, 0)).toBe(TRACK_FADE_TIME);
    expect(trackFadeTime(TRACK_FADE_TIME, -0.5)).toBe(TRACK_FADE_TIME);
  });

  it("shortens as snowfall increases (living refill)", () => {
    const light = trackFadeTime(TRACK_FADE_TIME, 0.25);
    const heavy = trackFadeTime(TRACK_FADE_TIME, 0.85);
    expect(light).toBeLessThan(TRACK_FADE_TIME);
    expect(heavy).toBeLessThan(light);
  });

  it("is monotonic non-increasing across the snowfall range", () => {
    let prev = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const f = trackFadeTime(TRACK_FADE_TIME, r);
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
    }
  });

  it("never drops below the fade floor", () => {
    expect(trackFadeTime(TRACK_FADE_TIME, 1)).toBeGreaterThanOrEqual(TRACK_MIN_FADE);
  });
});

describe("trackFade", () => {
  it("is 1 at age 0 and 0 at/after fadeTime", () => {
    expect(trackFade(0, TRACK_FADE_TIME)).toBe(1);
    expect(trackFade(TRACK_FADE_TIME, TRACK_FADE_TIME)).toBe(0);
    expect(trackFade(TRACK_FADE_TIME + 1, TRACK_FADE_TIME)).toBe(0);
  });

  it("clamps negative age to 1", () => {
    expect(trackFade(-2, TRACK_FADE_TIME)).toBe(1);
  });
});

describe("TrackRingCursor", () => {
  it("makeTrackRing sets capacity/head/count; clamps capacity < 1 to 1", () => {
    expect(makeTrackRing(3)).toEqual({ capacity: 3, head: 0, count: 0 });
    expect(makeTrackRing(0).capacity).toBe(1);
  });

  it("fills 0..N-1 then wraps; oldest slot reused first; count caps at N", () => {
    const cur = makeTrackRing(3);
    expect(trackRingPush(cur)).toBe(0);
    expect(trackRingPush(cur)).toBe(1);
    expect(trackRingPush(cur)).toBe(2);
    expect(trackRingPush(cur)).toBe(0);
    expect(cur).toEqual({ capacity: 3, head: 1, count: 3 });
  });
});

describe("TRACK_SEGMENTS (tier map)", () => {
  it("is larger than the skid budgets: low=512, med=1024, high=2048", () => {
    expect(TRACK_SEGMENTS).toEqual({ low: 512, med: 1024, high: 2048 });
  });
});
