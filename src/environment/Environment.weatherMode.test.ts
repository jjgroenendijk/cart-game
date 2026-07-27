import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import { dayCycleState } from "./dayCycle";
import { DynamicSky } from "./DynamicSky";
import type { SamplerTerrain } from "./propSampler";

beforeAll(async () => {
  await RAPIER.init();
});

function stubTerrain(): SamplerTerrain {
  const ringR = 60;
  const spawn = new THREE.Vector3(62, 0, 0);
  return {
    heightAt: () => 0,
    normalAt: (_x, _z, out = new THREE.Vector3()) => out.set(0, 1, 0),
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

const smallDressing = { tree: 2, rock: 1, bush: 3, flower: 8, grass: 12 };

describe("Environment — setWeatherMode (054 commit 5)", () => {
  it("snow -> setWeatherMode('storm') swaps the field to storm at full level", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "snow", seed: 0 },
    });
    // weather group is children[5] (dressing, clouds, water, sky, sun, weather).
    const weatherGroup = env.group.children[5] as THREE.Group;
    expect(weatherGroup.children.length).toBe(1); // snow field present

    env.setWeatherMode("storm");
    expect((weatherGroup.children[0] as THREE.Points).isPoints).toBe(true);
    expect(weatherGroup.children.length).toBe(1); // storm field swapped in
    expect(env.weatherInfo.preset).toBe("storm");
    env.dispose();
  });

  it("snow -> setWeatherMode('storm') applies storm dim (~0.7x) next update", () => {
    // Baseline: DynamicSky alone writes the un-dimmed intensity at the phase.
    const sky = new DynamicSky();
    sky.update(0.001);
    const baselineSun = dayCycleState.sunIntensity;
    sky.dispose();

    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "snow", seed: 0 },
    });
    env.setWeatherMode("storm");
    env.update(0.001, 0.001);
    // storm dimFactor 0.7 at level 1 (no flash this early).
    expect(dayCycleState.sunIntensity).toBeCloseTo(baselineSun * 0.7, 5);
    env.dispose();
  });

  it("storm -> setWeatherMode('clear') leaves an empty weather group", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "storm", seed: 0 },
    });
    const weatherGroup = env.group.children[5] as THREE.Group;
    expect(weatherGroup.children.length).toBe(1); // storm field present

    env.setWeatherMode("clear");
    expect(weatherGroup.children.length).toBe(0); // clear tears field down
    expect(env.weatherInfo.preset).toBe("clear");
    env.dispose();
  });

  it("setWeatherMode('snow') is a no-op field swap when already snow (no rebuild)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "snow", seed: 3 },
    });
    const weatherGroup = env.group.children[5] as THREE.Group;
    const pointsBefore = weatherGroup.children[0];
    // Same preset -> no rebuildField call; the Points object is preserved.
    env.setWeatherMode("snow");
    expect(weatherGroup.children[0]).toBe(pointsBefore);
    expect(env.weatherInfo.preset).toBe("snow");
    env.dispose();
  });

  it("auto schedule rebuilds the field on a preset change at level > 0", () => {
    // weights {rain:0.5,snow:0.5} + seed 0 -> seg0=snow, seg1=rain (boundary
    // at t=80). A fixed sim step lands just past the boundary where seg1's
    // fadeIn level is already > 0, so the old level<=0 gate skipped the swap.
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "snow", seed: 0, weights: { rain: 0.5, snow: 0.5 } },
    });
    env.setWeatherMode("auto"); // seg0=snow at full level; lastPreset=snow
    const weatherGroup = env.group.children[5] as THREE.Group;
    const snowField = weatherGroup.children[0];
    expect(env.weatherInfo.preset).toBe("snow");
    // Advance into seg1 (rain) where the fadeIn level is ~0.007 (> 0).
    env.update(80.5, 80.5);
    expect(env.weatherInfo.preset).toBe("rain");
    expect(weatherGroup.children[0]).not.toBe(snowField); // field rebuilt
    env.dispose();
  });
});
