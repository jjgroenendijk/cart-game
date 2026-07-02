import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_WEATHER_WEIGHTS,
  WEATHER_PRESET_CONFIG,
  Weather,
  advancePosition,
  selectWeatherPreset,
  type ParticleVec3,
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

  it('preset "rain" -> intensity 1, one Points on layer 0 with rain ShaderMaterial', () => {
    const weather = new Weather({ preset: "rain" });
    expect(weather.intensity).toBe(1);
    expect(weather.preset).toBe("rain");
    expect(weather.group.children.length).toBe(1);
    const pts = points(weather);
    expect(pts.layers.isEnabled(0)).toBe(true);
    const mat = pts.material as THREE.ShaderMaterial;
    const cfg = WEATHER_PRESET_CONFIG.rain;
    const u = mat.uniforms;
    expect(u.uColor.value.getHex()).toBe(new THREE.Color(cfg.color).getHex());
    expect(u.uSize.value).toBeCloseTo(cfg.size, 6);
    expect(u.uOpacity.value).toBeCloseTo(cfg.opacity, 6);
    expect(u.uTime.value).toBe(0);
    expect(u.uHalf.value).toBe(100);
    expect(u.uCeiling.value).toBe(60);
    expect(u.uFocusX.value).toBe(0);
    expect(u.uFocusZ.value).toBe(0);
    expect(mat.fog).toBe(true);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    weather.dispose();
  });

  it('preset "snow" -> intensity 1, one Points on layer 0 with snow ShaderMaterial', () => {
    const weather = new Weather({ preset: "snow" });
    expect(weather.intensity).toBe(1);
    expect(weather.preset).toBe("snow");
    expect(weather.group.children.length).toBe(1);
    const pts = points(weather);
    expect(pts.layers.isEnabled(0)).toBe(true);
    const mat = pts.material as THREE.ShaderMaterial;
    const cfg = WEATHER_PRESET_CONFIG.snow;
    const u = mat.uniforms;
    expect(u.uColor.value.getHex()).toBe(new THREE.Color(cfg.color).getHex());
    expect(u.uSize.value).toBeCloseTo(cfg.size, 6);
    expect(u.uOpacity.value).toBeCloseTo(cfg.opacity, 6);
    expect(u.uTime.value).toBe(0);
    expect(u.uHalf.value).toBe(100);
    expect(u.uCeiling.value).toBe(60);
    expect(mat.fog).toBe(true);
    expect(mat.transparent).toBe(true);
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

  it("velocity attribute: BufferAttribute, count = particleCount, itemSize 3", () => {
    const weather = new Weather({ preset: "rain", particleCount: 9 });
    const vel = points(weather).geometry.getAttribute("velocity") as THREE.BufferAttribute;
    expect(vel).toBeInstanceOf(THREE.BufferAttribute);
    expect(vel.count).toBe(9);
    expect(vel.itemSize).toBe(3);
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
      const mat = pts.material as THREE.ShaderMaterial;
      expect(mat.depthWrite).toBe(false);
      expect(mat.fog).toBe(true);
      // config is the source of truth for color/size/opacity.
      const cfg = WEATHER_PRESET_CONFIG[preset];
      const u = mat.uniforms;
      expect(u.uColor.value.getHex()).toBe(new THREE.Color(cfg.color).getHex());
      expect(u.uSize.value).toBeCloseTo(cfg.size, 6);
      expect(u.uOpacity.value).toBeCloseTo(cfg.opacity, 6);
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
  it("uTime advances by the accumulated dt (vertex shader drives motion)", () => {
    const weather = new Weather({ preset: "rain" });
    const mat = points(weather).material as THREE.ShaderMaterial;
    weather.update(0.1);
    weather.update(0.05);
    expect(mat.uniforms.uTime.value).toBeCloseTo(0.15, 6);
    weather.dispose();
  });

  it("upload-once: the position buffer is never mutated by update", () => {
    const weather = new Weather({ preset: "rain", particleCount: 8 });
    const pos = positions(weather);
    const before = Array.from(pos);
    weather.update(0.1, 12, -7);
    weather.update(0.05, 5, 5);
    weather.update(0.2, -3, 9);
    expect(pos.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(pos[i]).toBe(before[i]);
    }
    weather.dispose();
  });

  it("shader source: vertex wrap + gl_PointSize + fragment fog mix parity", () => {
    const weather = new Weather({ preset: "snow" });
    const mat = points(weather).material as THREE.ShaderMaterial;
    expect(mat.vertexShader).toContain("attribute vec3 velocity");
    expect(mat.vertexShader).toContain(
      "mod(position.x + velocity.x * uTime - uFocusX + uHalf, span)",
    );
    expect(mat.vertexShader).toContain(
      "mod(position.z + velocity.z * uTime - uFocusZ + uHalf, span)",
    );
    expect(mat.vertexShader).toContain("uCeiling - mod(fall, uCeiling)");
    expect(mat.vertexShader).toContain("gl_PointSize");
    expect(mat.fragmentShader).toContain("#ifdef USE_FOG");
    expect(mat.fragmentShader).toContain("smoothstep(fogNear, fogFar, -vViewPos.z)");
    expect(mat.fragmentShader).toContain("mix(c, fogColor, fogFactor)");
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
    const u = (points(weather).material as THREE.ShaderMaterial).uniforms;
    expect(u.uFocusX.value).toBe(50);
    expect(u.uFocusZ.value).toBe(30);
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

describe("Weather setLevel", () => {
  it("setLevel(1) on rain -> uOpacity == base config opacity, intensity 1", () => {
    const weather = new Weather({ preset: "rain" });
    weather.setLevel(1);
    const u = (points(weather).material as THREE.ShaderMaterial).uniforms;
    expect(u.uOpacity.value).toBeCloseTo(WEATHER_PRESET_CONFIG.rain.opacity, 6);
    expect(weather.intensity).toBe(1);
    weather.dispose();
  });

  it("setLevel(0) on rain -> uOpacity 0, intensity 0 (field still exists)", () => {
    const weather = new Weather({ preset: "rain" });
    weather.setLevel(0);
    const u = (points(weather).material as THREE.ShaderMaterial).uniforms;
    expect(u.uOpacity.value).toBe(0);
    expect(weather.intensity).toBe(0);
    expect(weather.group.children.length).toBe(1);
    weather.dispose();
  });

  it("setLevel(0.5) on rain -> uOpacity == cfg.opacity * 0.5", () => {
    const weather = new Weather({ preset: "rain" });
    weather.setLevel(0.5);
    const u = (points(weather).material as THREE.ShaderMaterial).uniforms;
    expect(u.uOpacity.value).toBeCloseTo(WEATHER_PRESET_CONFIG.rain.opacity * 0.5, 6);
    weather.dispose();
  });

  it("setLevel clamps to [0,1]: 2->1, -1->0, NaN->0", () => {
    const weather = new Weather({ preset: "rain" });
    weather.setLevel(2);
    expect(weather.intensity).toBe(1);
    weather.setLevel(-1);
    expect(weather.intensity).toBe(0);
    weather.setLevel(NaN);
    expect(weather.intensity).toBe(0);
    weather.dispose();
  });

  it("setLevel scales fog patch: level 0.5 -> near 90, far 185", () => {
    const weather = new Weather({ preset: "rain" });
    dayCycleState.fogNear = 100;
    dayCycleState.fogFar = 200;
    weather.setLevel(0.5);
    weather.update(0.016);
    expect(dayCycleState.fogNear).toBeCloseTo(90, 6); // 100*(1-0.2*0.5)
    expect(dayCycleState.fogFar).toBeCloseTo(185, 6); // 200*(1-0.15*0.5)
    weather.dispose();
  });

  it("clear preset: setLevel(1) is a no-op (intensity stays 0, no Points)", () => {
    const weather = new Weather({ preset: "clear" });
    expect(() => weather.setLevel(1)).not.toThrow();
    expect(weather.intensity).toBe(0);
    expect(weather.group.children.length).toBe(0);
    weather.dispose();
  });
});

describe("Weather rebuildField", () => {
  it("rain -> rebuildField('snow'): preset snow, 1 Points, snow color", () => {
    const weather = new Weather({ preset: "rain", seed: 7 });
    weather.rebuildField("snow", 7);
    expect(weather.preset).toBe("snow");
    expect(weather.group.children.length).toBe(1);
    const u = (points(weather).material as THREE.ShaderMaterial).uniforms;
    expect(u.uColor.value.getHex()).toBe(
      new THREE.Color(WEATHER_PRESET_CONFIG.snow.color).getHex(),
    );
    weather.dispose();
  });

  it("snow -> rebuildField('clear'): preset clear, group empty, intensity 0", () => {
    const weather = new Weather({ preset: "snow" });
    weather.rebuildField("clear", 0);
    expect(weather.preset).toBe("clear");
    expect(weather.group.children.length).toBe(0);
    expect(weather.intensity).toBe(0);
    expect(() => weather.update(0.016)).not.toThrow();
    weather.dispose();
  });

  it("clear -> rebuildField('rain'): preset rain, 1 Points, intensity tracks level", () => {
    const weather = new Weather({ preset: "clear" });
    weather.rebuildField("rain", 3);
    expect(weather.preset).toBe("rain");
    expect(weather.group.children.length).toBe(1);
    expect(weather.intensity).toBe(0); // clear level preserved
    weather.setLevel(1);
    expect(weather.intensity).toBe(1);
    weather.dispose();
  });

  it("rebuildField preserves determinism: rain 42 twice -> identical positions", () => {
    const weather = new Weather({ preset: "rain", seed: 1, particleCount: 16 });
    weather.rebuildField("rain", 42);
    const a = positions(weather);
    weather.rebuildField("rain", 42);
    const b = positions(weather);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
    weather.dispose();
  });

  it("rebuildField resets uTime to 0 after prior updates", () => {
    const weather = new Weather({ preset: "rain" });
    weather.update(0.2);
    weather.update(0.3);
    const before = (points(weather).material as THREE.ShaderMaterial).uniforms.uTime.value;
    expect(before).not.toBe(0);
    weather.rebuildField("snow", 5);
    const after = (points(weather).material as THREE.ShaderMaterial).uniforms.uTime.value;
    expect(after).toBe(0);
    weather.dispose();
  });
});

describe("advancePosition", () => {
  const mod = (v: number, s: number): number => ((v % s) + s) % s;

  it("t=0 returns base exactly (base inside the box)", () => {
    const base: ParticleVec3 = { x: 12, y: 5, z: -7 };
    const vel: ParticleVec3 = { x: 10, y: -25, z: 4 };
    const r = advancePosition(base, vel, 0, 100, 60);
    expect(r.x).toBeCloseTo(base.x, 6);
    expect(r.y).toBeCloseTo(base.y, 6);
    expect(r.z).toBeCloseTo(base.z, 6);
  });

  it("X bidirectional wrap: +vel crossing +half lands in [-half, half)", () => {
    const half = 50;
    const vel = 10;
    const base = 49.5;
    const t = 0.2; // 49.5 + 10*0.2 = 51.5 -> crosses +half
    const r = advancePosition({ x: base, y: 5, z: 0 }, { x: vel, y: -1, z: 0 }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.x).toBeCloseTo(expected, 6);
    expect(r.x).toBeGreaterThanOrEqual(-half);
    expect(r.x).toBeLessThan(half);
  });

  it("X bidirectional wrap: -vel crossing -half wraps the other way", () => {
    const half = 50;
    const vel = -10;
    const base = -49.5;
    const t = 0.2; // -49.5 - 10*0.2 = -51.5 -> crosses -half
    const r = advancePosition({ x: base, y: 5, z: 0 }, { x: vel, y: -1, z: 0 }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.x).toBeCloseTo(expected, 6);
    expect(r.x).toBeGreaterThanOrEqual(-half);
    expect(r.x).toBeLessThan(half);
  });

  it("Z wrap is independent and the same shape as X", () => {
    const half = 50;
    const vel = 10;
    const base = 49.5;
    const t = 0.3;
    const r = advancePosition({ x: 0, y: 5, z: base }, { x: 0, y: -1, z: vel }, t, half, 12);
    const expected = mod(base + vel * t + half, 2 * half) - half;
    expect(r.z).toBeCloseTo(expected, 6);
    expect(r.z).toBeGreaterThanOrEqual(-half);
    expect(r.z).toBeLessThan(half);
    // X untouched (base.x = 0, vel.x = 0)
    expect(r.x).toBeCloseTo(0, 6);
  });

  it("Y ceiling reset: fall > ceiling keeps y in [0, ceiling]", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    const t = 1.5; // fall = (12 - 11) + 25*1.5 = 39.5 > ceiling
    const r = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, t, 100, ceiling);
    const fall = ceiling - baseY + -vy * t;
    const expected = ceiling - mod(fall, ceiling);
    expect(r.y).toBeCloseTo(expected, 6);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(ceiling);
  });

  it("Y stays in [0, ceiling] as t grows", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    for (const t of [0.1, 1, 5, 50, 1000]) {
      const r = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, t, 100, ceiling);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(ceiling);
    }
  });

  it("Y periodicity: period = ceiling / -vel.y returns y ~= t=0", () => {
    const ceiling = 12;
    const baseY = 11;
    const vy = -25;
    const period = ceiling / -vy; // 0.48
    const r0 = advancePosition({ x: 0, y: baseY, z: 0 }, { x: 0, y: vy, z: 0 }, 0, 100, ceiling);
    const rp = advancePosition(
      { x: 0, y: baseY, z: 0 },
      { x: 0, y: vy, z: 0 },
      period,
      100,
      ceiling,
    );
    expect(rp.y).toBeCloseTo(r0.y, 6);
  });

  it("X periodicity: period = (2*half) / |vel.x| returns x ~= t=0", () => {
    const half = 50;
    const vx = 10;
    const baseX = 49.5;
    const period = (2 * half) / Math.abs(vx); // 10
    const r0 = advancePosition({ x: baseX, y: 5, z: 0 }, { x: vx, y: -1, z: 0 }, 0, half, 12);
    const rp = advancePosition({ x: baseX, y: 5, z: 0 }, { x: vx, y: -1, z: 0 }, period, half, 12);
    expect(rp.x).toBeCloseTo(r0.x, 6);
  });

  it("determinism: same inputs -> same outputs", () => {
    const base: ParticleVec3 = { x: 3.3, y: 4, z: -2.2 };
    const vel: ParticleVec3 = { x: 7, y: -9, z: 1.5 };
    const a = advancePosition(base, vel, 1.7, 50, 12);
    const b = advancePosition(base, vel, 1.7, 50, 12);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });

  it("focus=0 matches the legacy origin-anchored wrap", () => {
    const base: ParticleVec3 = { x: 12, y: 5, z: -7 };
    const vel: ParticleVec3 = { x: 4, y: -2, z: 1 };
    const r0 = advancePosition(base, vel, 3, 50, 12);
    const rDefault = advancePosition(base, vel, 3, 50, 12, 0, 0);
    expect(rDefault.x).toBeCloseTo(r0.x, 6);
    expect(rDefault.z).toBeCloseTo(r0.z, 6);
  });

  it("world-stationarity: shifting focus keeps a mid-box particle fixed", () => {
    const half = 50;
    const base: ParticleVec3 = { x: 10, y: 5, z: 10 };
    const vel: ParticleVec3 = { x: 0, y: -1, z: 0 };
    const r0 = advancePosition(base, vel, 0, half, 12, 0, 0);
    const r5 = advancePosition(base, vel, 0, half, 12, 5, 5);
    expect(r5.x).toBeCloseTo(r0.x, 6);
    expect(r5.z).toBeCloseTo(r0.z, 6);
  });

  it("world-stationarity with wind: focus shift does not add to world position", () => {
    const half = 50;
    const base: ParticleVec3 = { x: 0, y: 5, z: 0 };
    const vel: ParticleVec3 = { x: 3, y: -1, z: 1 };
    const t = 4;
    const r0 = advancePosition(base, vel, t, half, 12, 0, 0);
    const rShift = advancePosition(base, vel, t, half, 12, 17, -23);
    expect(rShift.x).toBeCloseTo(r0.x, 6);
    expect(rShift.z).toBeCloseTo(r0.z, 6);
  });

  it("recycle: a particle left behind past focus-half recycles ahead", () => {
    const half = 50;
    const span = 2 * half;
    const base: ParticleVec3 = { x: 0, y: 5, z: 0 };
    const vel: ParticleVec3 = { x: 0, y: -1, z: 0 };
    // focus far ahead: particle at world 0 is now behind focus by > half
    const r = advancePosition(base, vel, 0, half, 12, 70, 0);
    // recycled to span ahead of focus offset -> world stays in [focus-half, focus+half]
    expect(r.x).toBeCloseTo(base.x + span, 6);
    expect(r.x).toBeGreaterThanOrEqual(70 - half);
    expect(r.x).toBeLessThan(70 + half);
  });
});
