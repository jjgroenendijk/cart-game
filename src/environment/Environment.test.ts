import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import { CelWaterMaterial } from "../materials/celWater";
import { wetnessUniform } from "../materials/cel";
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
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

const smallDressing = { tree: 2, rock: 1, bush: 3, flower: 8, grass: 12 };

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

describe("Environment", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("bundles all env children (props..wildlife) into one group", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
      clouds: { count: 6 },
      water: { level: -3 },
    });
    // groups: dressing/clouds/water/dynamicSky/sunDisc/weather/wildlife.
    expect(env.group.children.length).toBe(7);
    const inst: THREE.InstancedMesh[] = [];
    env.group.traverse((c) => {
      if ((c as THREE.InstancedMesh).isInstancedMesh) inst.push(c as THREE.InstancedMesh);
    });
    // clouds + bush/flower/grass decor + wildlife InstancedMesh (>=5)
    expect(inst.length).toBeGreaterThanOrEqual(4);
    env.dispose();
  });

  it("update(dt, time) advances water uTime and drifts clouds", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
      clouds: { count: 4, driftSpeed: 5 },
    });
    // env.group holds, in order: dressing.group, clouds.group,
    // waterChunkManager.group (071: streamed tiles on layer 1), dynamicSky,
    // sunDisc, weather, wildlife. The water group's tiles share one material.
    const waterGroup = env.group.children[2] as THREE.Group;
    const tile = waterGroup.children[0] as THREE.Mesh;
    expect(tile.layers.isEnabled(1)).toBe(true);
    const waterMat = tile.material as CelWaterMaterial;
    // Groups by filter order: [dressing, clouds, water, dynamicSky, sunDisc, ...].
    const groups = env.group.children.filter((c) => c instanceof THREE.Group) as THREE.Group[];
    const cloudsGroup = groups[1]!;
    // Clouds recycle per-instance (group stays at origin); read a puff's X.
    const cloudsMesh = cloudsGroup.children[0] as THREE.InstancedMesh;
    const cm = new THREE.Matrix4();
    cloudsMesh.getMatrixAt(0, cm);
    const cx0 = cm.elements[12];

    expect(waterMat.uTime).toBe(0);
    env.update(2, 9.5);
    expect(waterMat.uTime).toBe(9.5);
    // drift 5 m/s * dt 2 = 10, wrapped within [-wrap, wrap] (wrap = 120).
    cloudsMesh.getMatrixAt(0, cm);
    const span = 2 * 120;
    const expected = ((((cx0 + 5 * 2 + 120) % span) + span) % span) - 120;
    expect(cm.elements[12]).toBeCloseTo(expected, 5);
    env.dispose();
  });

  it("update(dt, time) advances DynamicSky (writes dayCycleState)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
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
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
      weather: { preset: "rain" },
    });
    // Cascade: DynamicSky writes first, then Weather patches (rain, k=1).
    env.update(0.001, 0.001);
    expect(dayCycleState.fogNear).toBeCloseTo(skyOnlyNear * 0.8, 5);
    expect(dayCycleState.fogFar).toBeCloseTo(skyOnlyFar * 0.85, 5);
    env.dispose();
  });

  it("rain Environment sets wetnessUniform to 1 at level 1; clear leaves 0", () => {
    wetnessUniform.uWetness.value = 0;
    const physics = new PhysicsWorld(-24);
    const rainEnv = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "rain" },
    });
    rainEnv.update(0.001, 0.001);
    expect(wetnessUniform.uWetness.value).toBeCloseTo(1, 6);
    rainEnv.dispose();

    wetnessUniform.uWetness.value = 0;
    const clearEnv = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      weather: { preset: "clear" },
    });
    clearEnv.update(0.001, 0.001);
    expect(wetnessUniform.uWetness.value).toBe(0);
    clearEnv.dispose();
  });

  it("update cascade: SunDisc reads the DynamicSky-fresh sunDirWorld", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
    });
    // children[4] is the sunDisc group (dressing, clouds, water, sky, sun).
    const sunDiscMesh = (env.group.children[4] as THREE.Group).children[0] as THREE.Mesh;
    const savedDir = dayCycleState.sunDirWorld.clone();
    try {
      // Stomp a non-unit dir; DynamicSky.update overwrites the singleton first.
      dayCycleState.sunDirWorld.set(1, 1, 1);
      env.update(0.5, 0.5);
      const fresh = dayCycleState.sunDirWorld;
      expect(sunDiscMesh.position.x).toBeCloseTo(fresh.x * 1500, 4);
      expect(sunDiscMesh.position.y).toBeCloseTo(fresh.y * 1500, 4);
      expect(sunDiscMesh.position.z).toBeCloseTo(fresh.z * 1500, 4);
      // Stomped (1,1,1) is non-unit (len sqrt3 * 1500); fresh IS unit -> 1500.
      expect(sunDiscMesh.position.length()).toBeCloseTo(1500, 1);
    } finally {
      dayCycleState.sunDirWorld.copy(savedDir);
    }
    env.dispose();
  });

  it("constructs + cascades Wildlife, and dispose frees it", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
      wildlife: { seed: 7, critter: { count: 12, cell: 8 } },
    });
    // wildlife is the last child (index 6) and is a Group holding one InstancedMesh.
    const wildlifeGroup = env.group.children[6] as THREE.Group;
    expect(wildlifeGroup.children.length).toBe(1);
    const mesh = wildlifeGroup.children[0] as THREE.InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    // motion is a pure fn of absolute time; only assert change when count > 0.
    expect(mesh.count).toBeGreaterThan(0);
    const before = Array.from(mesh.instanceMatrix.array as Float32Array);
    env.update(0.1, 3.0); // cascade reaches wildlife.update(dt, 3.0)
    const after = Array.from(mesh.instanceMatrix.array as Float32Array);
    expect(after).not.toEqual(before);
    // dispose clears the group (wildlife.dispose -> group.clear).
    env.dispose();
    expect(env.group.children.length).toBe(0);
  });

  it("dispose removes all prop bodies and clears the group", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
    });
    expect(bodyCount(physics)).toBeGreaterThan(0);
    expect(env.group.children.length).toBeGreaterThan(0);
    env.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(env.group.children.length).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: {
        counts: smallDressing,
        cell: 6,
        streamRadius: 30,
        cullRadius: 40,
      },
    });
    env.dispose();
    expect(() => env.dispose()).not.toThrow();
  });
});
