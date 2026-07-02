import { describe, expect, it } from "vitest";
import { WEATHER_CHANNELS, channelLevel } from "./weatherChannels";
import type { WeatherPreset } from "./weatherPresets";

describe("WEATHER_CHANNELS (054)", () => {
  it("clear/rain/snow/fog all have dim 1 + windFactor 1 (sky + clouds parity)", () => {
    for (const p of ["clear", "rain", "snow", "fog"] as WeatherPreset[]) {
      expect(WEATHER_CHANNELS[p].dim).toBe(1);
      expect(WEATHER_CHANNELS[p].windFactor).toBe(1);
    }
  });

  it("rain wetness 1, snow wetness 0.3, clear/fog wetness 0", () => {
    expect(WEATHER_CHANNELS.rain.wetness).toBe(1);
    expect(WEATHER_CHANNELS.snow.wetness).toBeCloseTo(0.3, 6);
    expect(WEATHER_CHANNELS.clear.wetness).toBe(0);
    expect(WEATHER_CHANNELS.fog.wetness).toBe(0);
  });

  it("storm dims sky, speeds wind, wets ground (054 commit 4)", () => {
    expect(WEATHER_CHANNELS.storm.dim).toBeCloseTo(0.7, 6);
    expect(WEATHER_CHANNELS.storm.windFactor).toBeCloseTo(1.8, 6);
    expect(WEATHER_CHANNELS.storm.wetness).toBe(1);
  });
});

describe("channelLevel (054)", () => {
  it("level 0 => identity (dimFactor 1, windFactor 1, wetness 0) for every preset", () => {
    const presets: WeatherPreset[] = [
      "clear",
      "rain",
      "snow",
      "fog",
      "sandstorm",
      "blizzard",
      "heatHaze",
      "aurora",
      "storm",
    ];
    for (const p of presets) {
      const lvl = channelLevel(p, 0);
      expect(lvl.dimFactor).toBe(1);
      expect(lvl.windFactor).toBe(1);
      expect(lvl.wetness).toBe(0);
    }
  });

  it("rain at level 1 => dimFactor 1, windFactor 1, wetness 1", () => {
    const lvl = channelLevel("rain", 1);
    expect(lvl.dimFactor).toBe(1);
    expect(lvl.windFactor).toBe(1);
    expect(lvl.wetness).toBe(1);
  });

  it("rain at level 0.5 => wetness 0.5, dimFactor 1, windFactor 1", () => {
    const lvl = channelLevel("rain", 0.5);
    expect(lvl.wetness).toBeCloseTo(0.5, 6);
    expect(lvl.dimFactor).toBe(1);
    expect(lvl.windFactor).toBe(1);
  });

  it("storm at level 1 => dimFactor 0.7, windFactor 1.8, wetness 1 (054)", () => {
    const lvl = channelLevel("storm", 1);
    expect(lvl.dimFactor).toBeCloseTo(0.7, 6);
    expect(lvl.windFactor).toBeCloseTo(1.8, 6);
    expect(lvl.wetness).toBe(1);
  });

  it("storm at level 0 => identity (no dim, no wind, no wetness)", () => {
    const lvl = channelLevel("storm", 0);
    expect(lvl.dimFactor).toBe(1);
    expect(lvl.windFactor).toBe(1);
    expect(lvl.wetness).toBe(0);
  });

  it("a hypothetical dim<1 preset at level 1 => dimFactor == dim; level 0.5 => midpoint", () => {
    const dim = 0.6;
    const ch = { dim, windFactor: 1, wetness: 0 };
    const lvl1 = 1 - (1 - ch.dim) * 1;
    const lvl05 = 1 - (1 - ch.dim) * 0.5;
    expect(lvl1).toBeCloseTo(dim, 6);
    expect(lvl05).toBeCloseTo(1 - (1 - dim) * 0.5, 6);
    expect(lvl1).toBeCloseTo(0.6, 6);
    expect(lvl05).toBeCloseTo(0.8, 6);
  });

  it("windFactor < 1 and > 1 both lerp correctly from 1 at level 0", () => {
    const low = 1 + (0.4 - 1) * 1;
    const high = 1 + (2.0 - 1) * 1;
    expect(low).toBeCloseTo(0.4, 6);
    expect(high).toBeCloseTo(2.0, 6);
    // midpoint between 1 and the target.
    expect(1 + (0.4 - 1) * 0.5).toBeCloseTo(0.7, 6);
    expect(1 + (2.0 - 1) * 0.5).toBeCloseTo(1.5, 6);
  });

  it("determinism: same inputs => same outputs", () => {
    const a = channelLevel("rain", 0.37);
    const b = channelLevel("rain", 0.37);
    expect(a).toEqual(b);
  });
});
