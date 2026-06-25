import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import { CelWaterMaterial } from "../materials/celWater";
import { dayCycleState } from "./dayCycle";
import { DynamicSky } from "./DynamicSky";
import type { SamplerTerrain } from "./propSampler";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

function stubTerrain(): SamplerTerrain {
  const ringR = 60;
  const spawn = new THREE.Vector3(62, 0, 0);
  return {
    heightAt: () => 0,
    normalAt: (_x, _z, out = new THREE.Vector3()) => out.set(0, 1, 0),
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    spline: { closestPoint: (x, z) => ({ dist: Math.abs(Math.hypot(x, z) - ringR) }) },
  };
}

const small = { tree: 4, rock: 4, bush: 8, flower: 20, grass: 30 };

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

describe("Environment", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("bundles propField + clouds + water + dynamicSky + sunDisc + weather into one group", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      propField: { counts: small, cell: 8 },
      clouds: { count: 6 },
      water: { level: -3 },
    });
    // water mesh + propField/clouds/dynamicSky/sunDisc/weather groups are added.
    expect(env.group.children.length).toBe(6);
    const inst: THREE.InstancedMesh[] = [];
    env.group.traverse((c) => {
      if ((c as THREE.InstancedMesh).isInstancedMesh) inst.push(c as THREE.InstancedMesh);
    });
    // clouds + bush/flower/grass decor
    expect(inst.length).toBeGreaterThanOrEqual(4);
    env.dispose();
  });

  it("update(dt, time) advances water uTime and drifts clouds", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      propField: { counts: small, cell: 8 },
      clouds: { count: 4, driftSpeed: 5 },
    });
    const water = env.group.children.find(
      (c) => c instanceof THREE.Mesh && c.layers.isEnabled(1),
    ) as THREE.Mesh;
    const waterMat = water.material as CelWaterMaterial;
    // env.group holds, in order: propField.group, clouds.group, water.mesh,
    // dynamicSky.group, sunDisc.group, weather.group. Groups (excl. water Mesh):
    // [propField, clouds, dynamicSky, sunDisc, weather].
    const groups = env.group.children.filter((c) => c instanceof THREE.Group) as THREE.Group[];
    const cloudsGroup = groups[1]!;

    const x0 = cloudsGroup.position.x;
    expect(waterMat.uTime).toBe(0);
    env.update(2, 9.5);
    expect(waterMat.uTime).toBe(9.5);
    expect(cloudsGroup.position.x).toBeCloseTo(x0 + 5 * 2, 5);
    env.dispose();
  });

  it("update(dt, time) advances DynamicSky (writes dayCycleState)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      propField: { counts: small, cell: 8 },
    });
    env.update(0.5, 0.5);
    expect(dayCycleState.elapsed).toBeCloseTo(0.5, 6);
    env.dispose();
  });

  it("update cascades: weather patches fog AFTER DynamicSky writes it", () => {
    // Baseline: DynamicSky alone writes the unpatched fog at the same phase.
    const sky = new DynamicSky();
    sky.update(0.001);
    const skyOnlyNear = dayCycleState.fogNear;
    const skyOnlyFar = dayCycleState.fogFar;
    sky.dispose();

    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      propField: { counts: small, cell: 8 },
      weather: { preset: "rain" },
    });
    // Cascade: DynamicSky writes first, then Weather patches (rain, k=1).
    env.update(0.001, 0.001);
    expect(dayCycleState.fogNear).toBeCloseTo(skyOnlyNear * 0.8, 5);
    expect(dayCycleState.fogFar).toBeCloseTo(skyOnlyFar * 0.85, 5);
    env.dispose();
  });

  it("dispose removes all prop bodies and clears the group", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      propField: { counts: small, cell: 8 },
    });
    expect(bodyCount(physics)).toBeGreaterThan(0);
    expect(env.group.children.length).toBeGreaterThan(0);
    env.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(env.group.children.length).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), { propField: { counts: small, cell: 8 } });
    env.dispose();
    expect(() => env.dispose()).not.toThrow();
  });
});
