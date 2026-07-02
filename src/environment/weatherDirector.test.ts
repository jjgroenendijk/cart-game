import { describe, expect, it } from "vitest";
import { makeSchedule, levelAt } from "./weatherDirector";
import { DEFAULT_WEATHER_WEIGHTS, selectWeatherPreset, type WeatherPreset } from "./weatherPresets";

describe("makeSchedule determinism", () => {
  it("auto mode: same seed twice -> deep-equal segments + starts", () => {
    const a = makeSchedule(42, DEFAULT_WEATHER_WEIGHTS, "auto");
    const b = makeSchedule(42, DEFAULT_WEATHER_WEIGHTS, "auto");
    expect(b.segments).toEqual(a.segments);
    expect(b.starts).toEqual(a.starts);
  });

  it("levelAt is deterministic: same schedule + t -> equal result", () => {
    const s = makeSchedule(7, DEFAULT_WEATHER_WEIGHTS, "auto");
    for (const t of [0, 1, 40, 79.5, 80, 85, 1000, -5]) {
      expect(levelAt(s, t)).toEqual(levelAt(s, t));
    }
  });
});

describe("makeSchedule fixed mode", () => {
  it("rain -> one infinite segment; levelAt(any t) -> {rain, 1}", () => {
    const s = makeSchedule(0, DEFAULT_WEATHER_WEIGHTS, "rain");
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toEqual({
      preset: "rain",
      fadeInSec: 0,
      holdSec: Infinity,
      fadeOutSec: 0,
    });
    expect(s.starts).toEqual([0, Infinity]);
    for (const t of [0, 1, 100, 1e6]) {
      expect(levelAt(s, t)).toEqual({ preset: "rain", level: 1 });
    }
  });

  it("clear -> one infinite segment; levelAt(any t) -> {clear, 0}", () => {
    const s = makeSchedule(0, DEFAULT_WEATHER_WEIGHTS, "clear");
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]!.preset).toBe("clear");
    for (const t of [0, 1, 100, 1e6]) {
      expect(levelAt(s, t)).toEqual({ preset: "clear", level: 0 });
    }
  });

  it("each non-clear preset is a valid fixed single segment at level 1", () => {
    const presets: WeatherPreset[] = [
      "rain",
      "snow",
      "fog",
      "sandstorm",
      "blizzard",
      "heatHaze",
      "aurora",
    ];
    for (const preset of presets) {
      const s = makeSchedule(11, DEFAULT_WEATHER_WEIGHTS, preset);
      expect(s.segments).toHaveLength(1);
      expect(s.segments[0]!.preset).toBe(preset);
      expect(levelAt(s, 50).level).toBe(1);
    }
  });
});

describe("makeSchedule auto parity", () => {
  it("segment 0 preset == selectWeatherPreset(weights, seed)", () => {
    for (const seed of [0, 1, 42, 99, 200]) {
      const s = makeSchedule(seed, DEFAULT_WEATHER_WEIGHTS, "auto");
      expect(s.segments[0]!.preset).toBe(selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed));
    }
  });

  it("segment 0 fadeInSec == 0 (opens at full level 1 when non-clear)", () => {
    const s = makeSchedule(42, DEFAULT_WEATHER_WEIGHTS, "auto");
    expect(s.segments[0]!.fadeInSec).toBe(0);
    if (s.segments[0]!.preset !== "clear") {
      expect(levelAt(s, 0).level).toBe(1);
    }
  });

  it("auto generates AUTO_SEGMENTS fronts; last holds Infinity", () => {
    const s = makeSchedule(0, DEFAULT_WEATHER_WEIGHTS, "auto");
    expect(s.segments.length).toBe(10);
    expect(s.starts.length).toBe(11);
    const last = s.segments[s.segments.length - 1]!;
    expect(last.holdSec).toBe(Infinity);
    expect(last.fadeOutSec).toBe(0);
    expect(s.starts[s.starts.length - 1]).toBe(Infinity);
  });
});

describe("makeSchedule auto re-roll distribution", () => {
  it("segments 1+ reach >1 distinct preset across many seeds", () => {
    const reached = new Set<WeatherPreset>();
    for (let seed = 0; seed <= 200; seed++) {
      const s = makeSchedule(seed, DEFAULT_WEATHER_WEIGHTS, "auto");
      for (let i = 1; i < s.segments.length; i++) {
        reached.add(s.segments[i]!.preset);
      }
    }
    expect(reached.size).toBeGreaterThan(1);
  });

  it("per-segment sub-seed differs from the session pick", () => {
    // segment 1 uses seed ^ hashSeed("weather-seg1"), distinct from seed.
    const seed = 5;
    const s = makeSchedule(seed, DEFAULT_WEATHER_WEIGHTS, "auto");
    expect(s.segments[1]!.preset).toBe(
      selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed ^ (hashSeg("weather-seg1") >>> 0)),
    );
  });
});

// Local hashSeed mirror so the test asserts the documented sub-seed idiom
// without depending on rng internals beyond the public contract.
function hashSeg(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

describe("levelAt trapezoid envelope", () => {
  // All-rain weights so every auto segment is rain: isolates the envelope
  // shape from preset variation.
  const s = makeSchedule(0, { rain: 1 }, "auto");

  it("segment 0 hold region -> level 1", () => {
    expect(levelAt(s, 40).level).toBe(1);
    expect(levelAt(s, 65).level).toBe(1);
  });

  it("level 0 at every segment boundary", () => {
    // starts[1..segments.length-1] are finite handover times; the final
    // starts entry is Infinity (the holding last segment's total) and is
    // never an active boundary.
    for (let i = 1; i < s.segments.length; i++) {
      const t = s.starts[i]!;
      expect(levelAt(s, t).level).toBeLessThanOrEqual(1e-9);
    }
  });

  it("fade-in ramp 0->1 across segment 1 fadeIn", () => {
    const seg1Start = s.starts[1]!;
    const fadeIn = s.segments[1]!.fadeInSec;
    expect(levelAt(s, seg1Start).level).toBeCloseTo(0, 9);
    expect(levelAt(s, seg1Start + fadeIn / 2).level).toBeCloseTo(0.5, 6);
    expect(levelAt(s, seg1Start + fadeIn).level).toBe(1);
  });

  it("fade-out ramp 1->0 across segment 0 fadeOut", () => {
    const seg0 = s.segments[0]!;
    const fadeOutStart = seg0.fadeInSec + seg0.holdSec;
    const fadeOutEnd = fadeOutStart + seg0.fadeOutSec;
    expect(levelAt(s, fadeOutStart).level).toBe(1);
    expect(levelAt(s, (fadeOutStart + fadeOutEnd) / 2).level).toBeCloseTo(0.5, 6);
  });

  it("segment 1 hold region -> level 1", () => {
    const seg1Start = s.starts[1]!;
    const fadeIn = s.segments[1]!.fadeInSec;
    expect(levelAt(s, seg1Start + fadeIn + 20).level).toBe(1);
  });

  it("last segment holds forever -> level 1 for large t", () => {
    expect(levelAt(s, 1e6).level).toBe(1);
  });
});

describe("levelAt clamping", () => {
  it("negative t is treated as 0 (segment 0 start)", () => {
    const s = makeSchedule(0, DEFAULT_WEATHER_WEIGHTS, "rain");
    expect(levelAt(s, -100)).toEqual(levelAt(s, 0));
  });

  it("level stays within [0,1] across a full auto schedule sweep", () => {
    const s = makeSchedule(0, DEFAULT_WEATHER_WEIGHTS, "auto");
    for (let t = 0; t < 1000; t += 0.7) {
      const lv = levelAt(s, t).level;
      expect(lv).toBeGreaterThanOrEqual(0);
      expect(lv).toBeLessThanOrEqual(1);
    }
  });
});
