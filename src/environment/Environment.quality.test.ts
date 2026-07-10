import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Environment } from "./Environment";
import { CelWaterMaterial } from "../materials/celWater";
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

describe("Environment — setQuality (062)", () => {
  it("low zeroes the water glint; high restores it", () => {
    const physics = new PhysicsWorld(-24);
    const env = new Environment(physics, stubTerrain(), {
      dressing: { counts: smallDressing, cell: 6, streamRadius: 30, cullRadius: 40 },
    });
    // children[2] is the water group (071); its tiles share one material.
    const waterTile = (env.group.children[2] as THREE.Group).children[0] as THREE.Mesh;
    const waterMat = waterTile.material as CelWaterMaterial;
    expect(waterMat.glintIntensity).toBe(1); // ctor default (commit 2)
    env.setQuality("low");
    expect(waterMat.glintIntensity).toBe(0);
    env.setQuality("high");
    expect(waterMat.glintIntensity).toBe(1);
    env.dispose();
  });
});
