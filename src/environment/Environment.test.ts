import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment, biomeEnvironmentOptions } from "./Environment";
import { CelWaterMaterial } from "../materials/celWater";
import { dayCycleState } from "./dayCycle";
import { DynamicSky } from "./DynamicSky";
import { resolveBiome, type BiomeDefinition } from "../terrain/biomes";
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
    spline: {
      closestPoint: (x, z) => ({ dist: Math.abs(Math.hypot(x, z) - ringR) }),
    },
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
    // water mesh + dressing/clouds/dynamicSky/sunDisc/weather/wildlife groups.
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
    const water = env.group.children.find(
      (c) => c instanceof THREE.Mesh && c.layers.isEnabled(1),
    ) as THREE.Mesh;
    const waterMat = water.material as CelWaterMaterial;
    // env.group holds, in order: dressing.group, clouds.group, water.mesh,
    // dynamicSky.group, sunDisc.group, weather.group. Groups (excl. water Mesh):
    // [dressing, clouds, dynamicSky, sunDisc, weather].
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

describe("Environment — biome fan-out (025)", () => {
  it("biomeEnvironmentOptions maps temperate flora + weather (parity)", () => {
    const opts = biomeEnvironmentOptions(resolveBiome("temperate"));
    expect(opts.dressing.counts).toEqual({
      tree: 2,
      rock: 1,
      bush: 3,
      flower: 23,
      grass: 47,
    });
    expect(opts.weather.weights).toEqual({ clear: 0.7, rain: 0.15, snow: 0.15 });
    // Temperate leaves waterColor + wildlife undefined -> parity (no slice).
    expect(opts.water.color).toBeUndefined();
    expect(opts.wildlife.kinds).toBeUndefined();
  });

  it("routes a custom biome's flora + weather", () => {
    const def: BiomeDefinition = {
      id: "test",
      label: "Test",
      terrain: {},
      flora: [{ kind: "cactus", count: 50 }],
      weather: { sandstorm: 1 },
    };
    const opts = biomeEnvironmentOptions(def);
    expect(opts.dressing.counts).toEqual({ cactus: 50 });
    expect(opts.weather.weights).toEqual({ sandstorm: 1 });
  });

  it("routes a custom biome's waterColor + wildlife set", () => {
    const def: BiomeDefinition = {
      id: "test",
      label: "Test",
      terrain: {},
      flora: [],
      weather: {},
      waterColor: 0x112233,
      skyFogBias: { fogTint: 0xaa0000, skyTint: 0x0000aa },
      wildlife: ["a", "b"],
    };
    const opts = biomeEnvironmentOptions(def);
    expect(opts.water.color).toBe(0x112233);
    expect(opts.wildlife.kinds).toEqual(["a", "b"]);
  });

  it("biome flora flows into PropField counts; explicit caller opts win", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      biome: resolveBiome("temperate"),
      dressing: { counts: smallDressing, cell: 8 }, // explicit counts override biome's
    });
    expect(env.group.children.length).toBeGreaterThan(0);
    env.dispose();
  });

  it("dresses only the biome's flora kinds (kind-agnostic, no temperate bleed)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { streamRadius: 30, cullRadius: 40, cell: 6 },
      biome: {
        id: "yucca-only",
        label: "Yucca",
        terrain: {},
        flora: [{ kind: "yucca", count: 100 }],
        weather: {},
      },
    });
    // yucca is decor (no Rapier body) -> a decor-only biome creates NO prop
    // bodies. The pre-fix hardcoded-temperate dressing would have built
    // tree/rock big bodies here (>0); kind-agnostic dressing dresses yucca only.
    expect(bodyCount(physics)).toBe(0);
    // yucca IS dressed: a decor InstancedMesh lands in the dressing group
    // (env.group.children[0] is the dressing group).
    const dressingGroup = env.group.children[0] as THREE.Group;
    expect(dressingGroup.children.length).toBeGreaterThan(0);
    env.dispose();
  });

  it("rebuild (dispose + new) leaks no Rapier bodies over 3 cycles", () => {
    const physics = new PhysicsWorld(-24);
    const opts = {
      biome: resolveBiome("temperate") as BiomeDefinition,
      dressing: { counts: smallDressing, cell: 8 },
    };
    let env = new Environment(physics, stubTerrain(), opts);
    const baseline = bodyCount(physics);
    expect(baseline).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      env.dispose();
      env = new Environment(physics, stubTerrain(), opts);
      expect(bodyCount(physics)).toBe(baseline);
    }
    env.dispose();
    expect(bodyCount(physics)).toBe(0);
  });

  it("biome waterColor routes to Water uTint (temperate leaves white)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
      biome: {
        id: "tinted",
        label: "Tinted",
        terrain: {},
        flora: [],
        weather: {},
        waterColor: 0x112233,
      },
    });
    // children[2] is the water Mesh (dressing, clouds, water, ...).
    const waterMat = (env.group.children[2] as THREE.Mesh).material as CelWaterMaterial;
    expect(waterMat.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
    env.dispose();
    // Temperate -> white (parity).
    const envTemp = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
    });
    const tempMat = (envTemp.group.children[2] as THREE.Mesh).material as CelWaterMaterial;
    expect(tempMat.uniforms.uTint.value.getHex()).toBe(0xffffff);
    envTemp.dispose();
  });

  it("biome skyFogBias shifts fog + sky after DynamicSky; temperate is a no-op", () => {
    // Baseline: DynamicSky alone writes fog + sky at elapsed 0.001 (a fresh
    // DynamicSky starts at elapsed 0 -> update(0.001) lands on the same value
    // Environment's internal DynamicSky will write).
    const sky = new DynamicSky();
    sky.update(0.001);
    const baseFog = dayCycleState.fogColor.clone();
    const baseZenith = dayCycleState.skyZenith.clone();
    const baseHorizon = dayCycleState.skyHorizon.clone();
    sky.dispose();

    const fogTint = new THREE.Color(0xff0000);
    const skyTint = new THREE.Color(0x0000ff);
    const expectedFog = baseFog.clone().lerp(fogTint, 0.2);
    const expectedZenith = baseZenith.clone().lerp(skyTint, 0.2);
    const expectedHorizon = baseHorizon.clone().lerp(skyTint, 0.2);

    const physics = new PhysicsWorld(-24);
    const envBiased = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
      biome: {
        id: "bias",
        label: "Bias",
        terrain: {},
        flora: [],
        weather: {},
        skyFogBias: { fogTint: 0xff0000, skyTint: 0x0000ff },
      },
    });
    envBiased.update(0.001, 0.001);
    expect(dayCycleState.fogColor.r).toBeCloseTo(expectedFog.r, 5);
    expect(dayCycleState.fogColor.g).toBeCloseTo(expectedFog.g, 5);
    expect(dayCycleState.fogColor.b).toBeCloseTo(expectedFog.b, 5);
    expect(dayCycleState.skyZenith.r).toBeCloseTo(expectedZenith.r, 5);
    expect(dayCycleState.skyHorizon.r).toBeCloseTo(expectedHorizon.r, 5);
    envBiased.dispose();

    // Temperate: no bias -> fog + sky identical to the DynamicSky-only baseline.
    const envTemp = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
    });
    envTemp.update(0.001, 0.001);
    expect(dayCycleState.fogColor.r).toBeCloseTo(baseFog.r, 6);
    expect(dayCycleState.fogColor.g).toBeCloseTo(baseFog.g, 6);
    expect(dayCycleState.fogColor.b).toBeCloseTo(baseFog.b, 6);
    expect(dayCycleState.skyZenith.getHex()).toBe(baseZenith.getHex());
    envTemp.dispose();
  });

  it("biome wildlife [] opts out (empty group); temperate builds birds", () => {
    const physics = new PhysicsWorld(-24);
    const envEmpty = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
      biome: {
        id: "empty",
        label: "Empty",
        terrain: {},
        flora: [],
        weather: {},
        wildlife: [],
      },
    });
    // children[6] is the wildlife group (last child); empty set -> no mesh.
    const emptyGroup = envEmpty.group.children[6] as THREE.Group;
    expect(emptyGroup.children.length).toBe(0);
    envEmpty.dispose();

    // Temperate (no biome) -> wildlife present (bird InstancedMesh).
    const envTemp = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
    });
    const tempGroup = envTemp.group.children[6] as THREE.Group;
    expect(tempGroup.children.length).toBe(1);
    expect((tempGroup.children[0] as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    envTemp.dispose();
  });
});
