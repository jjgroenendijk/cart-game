import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_WEATHER_WEIGHTS,
  WEATHER_PRESET_CONFIG,
  Weather,
  selectWeatherPreset,
  type WeatherPreset,
} from "./Weather";
import { dayCycleState } from "./dayCycle";

function points(weather: Weather): THREE.Points {
  return weather.group.children.find((c) => c instanceof THREE.Points) as THREE.Points;
}

function positions(weather: Weather): Float32Array {
  const attr = points(weather).geometry.getAttribute("position") as THREE.BufferAttribute;
  return attr.array as Float32Array;
}

describe("selectWeatherPreset", () => {
  it("is deterministic (same seed -> same preset)", () => {
    for (const seed of [0, 1, 42, 99, 200]) {
      expect(selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed)).toBe(
        selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed),
      );
    }
  });

  it("reaches all three presets across seeds 0..200 (default weights)", () => {
    const reached = new Set<WeatherPreset>();
    for (let seed = 0; seed <= 200; seed++) {
      reached.add(selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed));
    }
    expect(reached.size).toBe(3);
  });

  it("clear is the majority (~70% -> at least 50% of trials)", () => {
    let clear = 0;
    const trials = 201;
    for (let seed = 0; seed < trials; seed++) {
      if (selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed) === "clear") clear++;
    }
    expect(clear / trials).toBeGreaterThanOrEqual(0.5);
  });

  it("new-presets-only weights reach all 5 and never clear/rain/snow", () => {
    const weights = { fog: 1, sandstorm: 1, blizzard: 1, heatHaze: 1, aurora: 1 };
    const reached = new Set<WeatherPreset>();
    for (let seed = 0; seed <= 200; seed++) {
      const p = selectWeatherPreset(weights, seed);
      reached.add(p);
      expect(p).not.toBe("clear");
      expect(p).not.toBe("rain");
      expect(p).not.toBe("snow");
    }
    expect(reached.size).toBe(5);
  });

  it("zero / empty weights -> clear", () => {
    expect(selectWeatherPreset({}, 0)).toBe("clear");
    expect(selectWeatherPreset({ clear: 0, rain: 0 }, 0)).toBe("clear");
    expect(selectWeatherPreset({ unknownPreset: 5 }, 0)).toBe("clear");
  });
});

describe("Weather construction", () => {
  it('preset "clear" -> intensity 0, empty group (no Points built)', () => {
    const weather = new Weather({ preset: "clear" });
    expect(weather.intensity).toBe(0);
    expect(weather.preset).toBe("clear");
    expect(weather.group.children.length).toBe(0);
    weather.dispose();
  });

  it('preset "rain" -> intensity 1, one Points on layer 0 with rain material', () => {
    const weather = new Weather({ preset: "rain" });
    expect(weather.intensity).toBe(1);
    expect(weather.preset).toBe("rain");
    expect(weather.group.children.length).toBe(1);
    const pts = points(weather);
    expect(pts.layers.isEnabled(0)).toBe(true);
    const mat = pts.material as THREE.PointsMaterial;
    expect(mat.color.getHex()).toBe(new THREE.Color(0x8090a0).getHex());
    expect(mat.size).toBeCloseTo(1.5, 6);
    expect(mat.opacity).toBeCloseTo(0.6, 6);
    expect(mat.depthWrite).toBe(false);
    expect(mat.fog).toBe(true); // default retained for natural fade
    weather.dispose();
  });

  it('preset "snow" -> intensity 1, one Points on layer 0 with snow material', () => {
    const weather = new Weather({ preset: "snow" });
    expect(weather.intensity).toBe(1);
    expect(weather.preset).toBe("snow");
    expect(weather.group.children.length).toBe(1);
    const pts = points(weather);
    expect(pts.layers.isEnabled(0)).toBe(true);
    const mat = pts.material as THREE.PointsMaterial;
    expect(mat.color.getHex()).toBe(new THREE.Color(0xffffff).getHex());
    expect(mat.size).toBeCloseTo(2.5, 6);
    expect(mat.opacity).toBeCloseTo(0.85, 6);
    expect(mat.depthWrite).toBe(false);
    weather.dispose();
  });

  it("particleCount option is respected (geometry attribute count)", () => {
    const weather = new Weather({ preset: "rain", particleCount: 7 });
    const attr = points(weather).geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(attr.count).toBe(7);
    expect(attr.itemSize).toBe(3);
    weather.dispose();
  });

  it("default pick (no preset) matches selectWeatherPreset(weights, seed)", () => {
    const seed = 42;
    const weather = new Weather({ seed });
    expect(weather.preset).toBe(selectWeatherPreset(DEFAULT_WEATHER_WEIGHTS, seed));
    weather.dispose();
  });

  it("weights option drives the pick (new-presets-only reaches a new preset)", () => {
    const weights = { fog: 1, sandstorm: 1, blizzard: 1, heatHaze: 1, aurora: 1 };
    const reached = new Set<WeatherPreset>();
    for (let seed = 0; seed < 50; seed++) {
      const w = new Weather({ weights, seed });
      reached.add(w.preset);
      w.dispose();
    }
    expect(reached.size).toBeGreaterThan(0);
    for (const p of reached) expect(p).not.toBe("clear");
  });
});

describe("Weather construction (new presets)", () => {
  const newPresets = ["fog", "sandstorm", "blizzard", "heatHaze", "aurora"] as const;

  for (const preset of newPresets) {
    it(`preset "${preset}" -> intensity 1, one Points on layer 0, dispose idempotent`, () => {
      const weather = new Weather({ preset });
      expect(weather.intensity).toBe(1);
      expect(weather.preset).toBe(preset);
      expect(weather.group.children.length).toBe(1);
      const pts = points(weather);
      expect(pts.layers.isEnabled(0)).toBe(true);
      const mat = pts.material as THREE.PointsMaterial;
      expect(mat.depthWrite).toBe(false);
      expect(mat.fog).toBe(true);
      // config is the source of truth for color/size/opacity.
      const cfg = WEATHER_PRESET_CONFIG[preset];
      expect(mat.color.getHex()).toBe(new THREE.Color(cfg.color).getHex());
      expect(mat.size).toBeCloseTo(cfg.size, 6);
      expect(mat.opacity).toBeCloseTo(cfg.opacity, 6);
      weather.dispose();
      expect(() => weather.dispose()).not.toThrow();
    });
  }

  it("aurora honours its ceiling override (spawn altitude < 55)", () => {
    const weather = new Weather({ preset: "aurora", particleCount: 64 });
    const pos = positions(weather);
    let maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]!);
    expect(maxY).toBeLessThanOrEqual(WEATHER_PRESET_CONFIG.aurora.ceiling!);
    weather.dispose();
  });
});

describe("Weather particle determinism", () => {
  it("same seed + rain -> identical initial positions", () => {
    const a = new Weather({ preset: "rain", seed: 42, particleCount: 16 });
    const b = new Weather({ preset: "rain", seed: 42, particleCount: 16 });
    const pa = positions(a);
    const pb = positions(b);
    expect(pb.length).toBe(pa.length);
    for (let i = 0; i < pa.length; i++) expect(pb[i]).toBe(pa[i]);
    a.dispose();
    b.dispose();
  });

  it("same seed + snow -> identical initial positions", () => {
    const a = new Weather({ preset: "snow", seed: 42, particleCount: 16 });
    const b = new Weather({ preset: "snow", seed: 42, particleCount: 16 });
    const pa = positions(a);
    const pb = positions(b);
    for (let i = 0; i < pa.length; i++) expect(pb[i]).toBe(pa[i]);
    a.dispose();
    b.dispose();
  });

  it("same seed, rain vs snow -> different positions (preset in the seed)", () => {
    const rain = new Weather({ preset: "rain", seed: 42, particleCount: 16 });
    const snow = new Weather({ preset: "snow", seed: 42, particleCount: 16 });
    const pr = positions(rain);
    const ps = positions(snow);
    let diff = 0;
    for (let i = 0; i < pr.length; i++) if (ps[i] !== pr[i]) diff++;
    expect(diff).toBeGreaterThan(0);
    rain.dispose();
    snow.dispose();
  });
});

describe("Weather update(dt)", () => {
  it("rain falls fast (vy ~ -25) with constant +X wind drift", () => {
    const weather = new Weather({
      preset: "rain",
      particleCount: 4,
      ceiling: 10,
      windSpeed: 5,
    });
    const pos = positions(weather);
    const x0 = pos[0]!;
    const y0 = pos[1]!;
    weather.update(0.1);
    // vy = -25 -> dY = -2.5 (or wrap to ceiling if it crossed the ground).
    const expectedY = y0 - 2.5 < 0 ? 10 : y0 - 2.5;
    expect(pos[1]).toBeCloseTo(expectedY, 6);
    // vx = windSpeed = 5 -> dX = +0.5 (worldHalf default 100 -> no X wrap).
    expect(pos[0]).toBeCloseTo(x0 + 0.5, 6);
    weather.dispose();
  });

  it("snow falls slow (vy ~ -2)", () => {
    const weather = new Weather({
      preset: "snow",
      particleCount: 4,
      ceiling: 10,
      windSpeed: 0,
    });
    const pos = positions(weather);
    const y0 = pos[1]!;
    weather.update(0.1);
    const expectedY = y0 - 0.2 < 0 ? 10 : y0 - 0.2; // vy = -2 -> dY = -0.2
    expect(pos[1]).toBeCloseTo(expectedY, 6);
    weather.dispose();
  });

  it("Y wraps from below ground back to ceiling", () => {
    const weather = new Weather({ preset: "rain", particleCount: 2, ceiling: 12, windSpeed: 0 });
    const pos = positions(weather);
    pos[1] = -1; // particle 0 below ground
    weather.update(0.016); // falls further -> below 0 -> reset to ceiling
    expect(pos[1]).toBeCloseTo(12, 6);
    weather.dispose();
  });

  it("X wraps across the world box", () => {
    const weather = new Weather({
      preset: "rain",
      particleCount: 2,
      worldHalfExtent: 50,
      windSpeed: 10,
    });
    const pos = positions(weather);
    pos[0] = 49.5; // near +X edge
    weather.update(0.1); // vx = 10 -> +1 -> 50.5 > 50 -> wrap to -50
    expect(pos[0]).toBeCloseTo(-50, 6);
    weather.dispose();
  });

  it("clear preset: update is a no-op (no throw, no Points)", () => {
    const weather = new Weather({ preset: "clear" });
    expect(() => weather.update(0.5)).not.toThrow();
    expect(weather.group.children.length).toBe(0);
    weather.dispose();
  });

  it("rain patches dayCycleState fog (near -20%, far -15%, color lerp)", () => {
    const weather = new Weather({ preset: "rain" });
    // Simulate DynamicSky having just written the singleton this frame.
    dayCycleState.fogNear = 100;
    dayCycleState.fogFar = 200;
    weather.update(0.016);
    expect(dayCycleState.fogNear).toBeCloseTo(80, 6); // 100 * (1 - 0.20)
    expect(dayCycleState.fogFar).toBeCloseTo(170, 6); // 200 * (1 - 0.15)
    weather.dispose();
  });

  it("rain update follows focus XZ", () => {
    const weather = new Weather({ preset: "rain", particleCount: 4 });
    weather.update(0.1, 50, 30);
    expect(weather.group.position.x).toBe(50);
    expect(weather.group.position.z).toBe(30);
    weather.dispose();
  });

  it("clear update does not follow focus (no-op early return)", () => {
    const weather = new Weather({ preset: "clear" });
    weather.update(0.1, 50, 30);
    expect(weather.group.position.x).toBe(0);
    expect(weather.group.position.z).toBe(0);
    weather.dispose();
  });
});

describe("Weather dispose", () => {
  it("is idempotent (calling twice does not throw)", () => {
    const weather = new Weather({ preset: "rain" });
    weather.dispose();
    expect(() => weather.dispose()).not.toThrow();
  });

  it("is idempotent for the clear preset too", () => {
    const weather = new Weather({ preset: "clear" });
    weather.dispose();
    expect(() => weather.dispose()).not.toThrow();
  });
});
