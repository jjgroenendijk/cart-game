import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment, biomeEnvironmentOptions } from "./Environment";
import { CelWaterMaterial } from "../materials/celWater";
import { dayCycleState } from "./dayCycle";
import { DynamicSky } from "./DynamicSky";
import { resolveBiome, type BiomeDefinition } from "./biomes/registry";
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

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

describe("Environment — biome fan-out (025)", () => {
  it("biomeEnvironmentOptions maps temperate flora + weather (parity)", () => {
    const opts = biomeEnvironmentOptions(resolveBiome("temperate"));
    expect(opts.dressing.counts).toEqual({
      tree: 2,
      birch: 2,
      forestPine: 1,
      rock: 1,
      bush: 3,
      tallGrass: 10,
      flower: 20,
      grass: 40,
    });
    expect(opts.weather.weights).toEqual({ clear: 0.7, rain: 0.15, snow: 0.15 });
    // Temperate leaves waterColor + shallow/deep + wildlife undefined -> parity.
    expect(opts.water.color).toBeUndefined();
    expect(opts.water.shallow).toBeUndefined();
    expect(opts.water.deep).toBeUndefined();
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
    // children[2] is the water group (071); its tiles share one material.
    const waterTile = (env.group.children[2] as THREE.Group).children[0] as THREE.Mesh;
    const waterMat = waterTile.material as CelWaterMaterial;
    expect(waterMat.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
    env.dispose();
    // Temperate -> white (parity).
    const envTemp = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 8 },
    });
    const tempTile = (envTemp.group.children[2] as THREE.Group).children[0] as THREE.Mesh;
    const tempMat = tempTile.material as CelWaterMaterial;
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
