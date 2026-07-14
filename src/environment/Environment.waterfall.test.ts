import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import type { BiomeDefinition } from "./biomes/registry";
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

describe("Environment — autumn waterfall landmark", () => {
  const autumnBiome: BiomeDefinition = {
    id: "autumn",
    label: "Autumn Forest",
    terrain: {},
    flora: [],
    weather: { clear: 1 },
  };

  it("builds a waterfall (extra group with a mist Points) for the autumn biome", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      biome: autumnBiome,
    });
    // Base env children are 7 (dressing..wildlife); autumn adds the waterfall.
    expect(env.group.children.length).toBe(8);
    const waterfallGroup = env.group.children[7] as THREE.Group;
    const mist = waterfallGroup.children.find((c) => c instanceof THREE.Points);
    expect(mist).toBeDefined();
    env.dispose();
    expect(env.group.children.length).toBe(0);
  });

  it("advances the waterfall's animated uTime on update", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      biome: autumnBiome,
    });
    const waterfallGroup = env.group.children[7] as THREE.Group;
    const mist = waterfallGroup.children.find((c) => c instanceof THREE.Points) as THREE.Points;
    const mat = mist.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uTime.value).toBe(0);
    env.update(0.5, 0.5);
    expect(mat.uniforms.uTime.value).toBeCloseTo(0.5, 6);
    env.dispose();
  });

  it("builds NO waterfall for a non-autumn biome (parity: 7 children)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
      biome: {
        id: "not-autumn",
        label: "Other",
        terrain: {},
        flora: [],
        weather: { clear: 1 },
      },
    });
    expect(env.group.children.length).toBe(7);
    // No Points beyond the weather field's (weather is clear -> none), so the
    // waterfall's mist Points is absent.
    const groups = env.group.children.filter((c) => c instanceof THREE.Group) as THREE.Group[];
    const anyWaterfallMist = groups
      .slice(7) // beyond the 7 base groups there are none
      .some((g) => g.children.some((c) => c instanceof THREE.Points));
    expect(anyWaterfallMist).toBe(false);
    env.dispose();
  });

  it("builds NO waterfall when no biome is given (parity: 7 children)", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
    });
    expect(env.group.children.length).toBe(7);
    env.dispose();
  });
});
