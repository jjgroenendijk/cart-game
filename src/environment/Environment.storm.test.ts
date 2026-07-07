import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import { dayCycleState } from "./dayCycle";
import { DynamicSky } from "./DynamicSky";
import { makeLightningSchedule } from "./lightning";
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

describe("Environment — storm preset (054 commit 4)", () => {
  it("dims sunIntensity to ~0.7x baseline at level 1 (no flash)", () => {
    // Baseline: DynamicSky alone writes the un-dimmed intensity at the phase.
    const sky = new DynamicSky();
    sky.update(0.001);
    const baselineSun = dayCycleState.sunIntensity;
    sky.dispose();

    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "storm", seed: 0 },
    });
    // weatherElapsed 0.001 is well before the first flash (>= 8s) -> no flash.
    env.update(0.001, 0.001);
    // storm dimFactor 0.7 at level 1.
    expect(dayCycleState.sunIntensity).toBeCloseTo(baselineSun * 0.7, 5);
    env.dispose();
  });

  it("active flash boosts sunIntensity above the dimmed baseline", () => {
    const flashAt = makeLightningSchedule(0).flashes[0]!.atSec;
    const t = flashAt + 0.001; // just inside the flash window [atSec, +0.08)

    // Baseline at the same phase (DynamicSky-only).
    const sky = new DynamicSky();
    sky.update(t);
    const baselineSun = dayCycleState.sunIntensity;
    sky.dispose();

    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "storm", seed: 0 },
    });
    // One update with dt = t so weatherElapsed lands inside the flash window.
    env.update(t, t);
    // Dimmed expectation (no flash) would be baselineSun * 0.7; the flash
    // adds a positive boost, so the live value must exceed it.
    expect(dayCycleState.sunIntensity).toBeGreaterThan(baselineSun * 0.7);
    env.dispose();
  });

  it("weatherInfo exposes the resolved storm front snapshot", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "storm", seed: 9 },
    });
    env.update(0.5, 0.5);
    const info = env.weatherInfo;
    expect(info.preset).toBe("storm");
    expect(info.level).toBe(1);
    expect(info.elapsed).toBeCloseTo(0.5, 6);
    expect(info.seed).toBe(9);
    env.dispose();
  });
});
