import { describe, expect, it } from "vitest";
import {
  buildDebugSnapshot,
  perfFromFrameStats,
  type DayLike,
  type DebugSnapshotAccessors,
  type WeatherLike,
} from "./debugSnapshot";
import type { KartLike } from "../kart/kartSnapshot";
import type { KartProgress, RaceSnapshot } from "../race/raceManager";
import type { PerfSample } from "./stats";

describe("perfFromFrameStats", () => {
  const fs = { calls: 42, triangles: 120000, geometries: 30, textures: 12 };

  it("maps FrameStats fields onto PerfSample names", () => {
    const p = perfFromFrameStats(fs, 16);
    expect(p.drawCalls).toBe(42);
    expect(p.tris).toBe(120000);
    expect(p.geometries).toBe(30);
    expect(p.textures).toBe(12);
    expect(p.frameMs).toBe(16);
    expect(p.fps).toBeCloseTo(62.5, 3);
  });

  it("maps a NaN frame time (no frame sampled) to 0 ms and 0 fps", () => {
    const p = perfFromFrameStats(fs, Number.NaN);
    expect(p.frameMs).toBe(0);
    expect(p.fps).toBe(0);
  });
});

function fakeKart(): KartLike {
  return {
    speed: 10,
    controller: {
      body: {
        translation: () => ({ x: 1, y: 0, z: 2 }),
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
        angvel: () => ({ x: 0, y: 0, z: 0 }),
      },
      grounded: true,
      isDrifting: false,
      driftActive: false,
      life: 1,
      inWater: false,
      wheels: [],
      tuning: {
        mass: 260,
        maxSpeed: 34,
        engineForce: 9000,
        brakeForce: 11000,
        grip: 9.5,
        wheelRadius: 0.35,
      },
    },
  };
}

const WEATHER: WeatherLike = {
  preset: "clear",
  level: 0.3,
  elapsed: 12,
  seed: 42,
};

const DAY: DayLike = {
  elapsed: 30,
  cycleT: 0.25,
  sunElevationDeg: 62,
  sunAzimuthDeg: 180,
  phase: "day",
  nightFactor: 0,
  sunIntensity: 2,
  ambientIntensity: 1,
  fogNear: 90,
  fogFar: 360,
  shadowFade: 1,
};

const PERF: PerfSample = {
  frameMs: 12,
  fps: 83,
  drawCalls: 40,
  tris: 120000,
  geometries: 20,
  textures: 10,
  shadowCasters: 8,
};

function fakeProgress(): KartProgress {
  return {
    lap: 1,
    sectorIdx: 2,
    cumArcLen: 1.5,
    lastT: 0.4,
    finished: false,
    finishTime: null,
  };
}

function fakeRace(): RaceSnapshot {
  return {
    phase: "racing",
    timer: 5,
    leaderLap: 1,
    positions: [1, 2],
    order: [0, 1],
    progress: [fakeProgress(), fakeProgress()],
  };
}

describe("buildDebugSnapshot", () => {
  it("assembles the full shape from all accessors", () => {
    const acc: DebugSnapshotAccessors = {
      state: "racing",
      time: 5,
      seed: 7,
      biome: "temperate",
      weather: WEATHER,
      day: DAY,
      quality: { tier: "high" },
      perf: PERF,
      karts: [fakeKart()],
      race: fakeRace(),
    };
    const snap = buildDebugSnapshot(acc);
    expect(snap.state).toBe("racing");
    expect(snap.time).toBe(5);
    expect(snap.seed).toBe(7);
    expect(snap.biome).toBe("temperate");
    expect(snap.weather).toEqual(WEATHER);
    expect(snap.day).toEqual(DAY);
    expect(snap.quality).toEqual({ tier: "high" });
    expect(snap.perf).toEqual(PERF);
    expect(snap.race?.phase).toBe("racing");
    expect(snap.karts).toHaveLength(1);
    expect(snap.karts[0].pos).toEqual({ x: 1, y: 0, z: 2 });
  });

  it("resolves absent optional accessors to null and karts to []", () => {
    const snap = buildDebugSnapshot({});
    expect(snap.state).toBeNull();
    expect(snap.time).toBeNull();
    expect(snap.seed).toBeNull();
    expect(snap.biome).toBeNull();
    expect(snap.weather).toBeNull();
    expect(snap.day).toBeNull();
    expect(snap.quality).toBeNull();
    expect(snap.perf).toBeNull();
    expect(snap.race).toBeNull();
    expect(snap.karts).toEqual([]);
  });

  it("deep-copies the race snapshot (survives buffer reuse)", () => {
    const race = fakeRace();
    const snap = buildDebugSnapshot({ race });
    // Simulate RaceManager overwriting its reused buffer in place.
    race.phase = "finished";
    race.positions[0] = 99;
    race.progress[0].lap = 42;
    expect(snap.race?.phase).toBe("racing");
    expect(snap.race?.positions[0]).toBe(1);
    expect(snap.race?.progress[0].lap).toBe(1);
  });

  it("deep-copies day/weather/perf so later mutation does not leak", () => {
    const day = { ...DAY };
    const weather = { ...WEATHER };
    const perf = { ...PERF };
    const snap = buildDebugSnapshot({ day, weather, perf });
    day.cycleT = 0.9;
    weather.level = 1;
    perf.frameMs = 99;
    expect(snap.day?.cycleT).toBe(0.25);
    expect(snap.weather?.level).toBe(0.3);
    expect(snap.perf?.frameMs).toBe(12);
  });

  it("omits shadowCasters when the perf sample lacks it", () => {
    const perf: PerfSample = {
      frameMs: 12,
      fps: 83,
      drawCalls: 40,
      tris: 120000,
      geometries: 20,
      textures: 10,
    };
    const snap = buildDebugSnapshot({ perf });
    expect(snap.perf).not.toHaveProperty("shadowCasters");
  });

  it("produces a JSON-serializable object", () => {
    const snap = buildDebugSnapshot({
      state: "menu",
      karts: [fakeKart()],
      race: fakeRace(),
      day: DAY,
    });
    expect(() => JSON.stringify(snap)).not.toThrow();
  });
});
