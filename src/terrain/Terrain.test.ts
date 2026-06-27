import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "./Terrain";

// Rapier wasm must init before any World/collider construction.
let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/** Small fast terrain (40m, 4x4 chunks of 10m) for unit tests. The standard
 * track (radius ~60) sits outside this world, so every sample is full-weight
 * off-track -> heightAt is a smooth deterministic field, ideal for the
 * raycast + seam check. */
function makeTerrain(override: { gridCount?: number; worldSize?: number } = {}) {
  const physics = new PhysicsWorld(-24);
  const terrain = new Terrain(physics, {
    worldSize: override.worldSize ?? 40,
    gridCount: override.gridCount ?? 4,
    cacheCell: 2,
    config: { noiseSeed: 1 },
  });
  return { physics, terrain };
}

describe("Terrain", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("chunks tile the world at gridCount^2", () => {
    const { terrain } = makeTerrain({ gridCount: 4 });
    expect(terrain.chunks.activeCount).toBe(16);
    expect(terrain.group.children.length).toBeGreaterThan(0);
    terrain.dispose();
  });

  it("chunked collider surface matches heightAt everywhere (raycast + seam guard)", () => {
    // Each chunk collider shares its verts with heightAt via the HeightSource;
    // a winding/coverage error would show as misses or large height error at a
    // chunk boundary. gridCount 4 over worldSize 40 -> 10m chunks; step 2
    // samples cross several boundaries (-10/0/10).
    const { physics, terrain } = makeTerrain({ gridCount: 4, worldSize: 40 });
    physics.step(); // broadphase must be built before raycasts hit
    const ray = new RAPIER.Ray({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    let misses = 0;
    let worst = 0;
    for (let z = -16; z <= 16; z += 2) {
      for (let x = -16; x <= 16; x += 2) {
        ray.origin = { x, y: 100, z };
        const hit = physics.world.castRayAndGetNormal(ray, 200, true);
        if (!hit) {
          misses++;
          continue;
        }
        const surfaceY = 100 - hit.timeOfImpact;
        worst = Math.max(worst, Math.abs(surfaceY - terrain.heightAt(x, z)));
      }
    }
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(0.3);
    terrain.dispose();
  });

  it("startPos + startYaw delegate to the spline", () => {
    const { terrain } = makeTerrain();
    const p = terrain.startPos();
    expect(p.distanceTo(terrain.spline.startPos())).toBeLessThan(1e-6);
    expect(terrain.startYaw()).toBe(terrain.spline.startYaw());
    terrain.dispose();
  });

  it("normalAt returns a unit-length upward-facing vector", () => {
    const { terrain } = makeTerrain();
    const n = terrain.normalAt(0, 0);
    expect(n.length()).toBeCloseTo(1, 5);
    expect(n.y).toBeGreaterThan(0.5);
    terrain.dispose();
  });

  it("dispose frees every chunk body + wall (body count -> 0)", () => {
    const { physics, terrain } = makeTerrain();
    let before = 0;
    physics.world.forEachRigidBody(() => before++);
    expect(before).toBeGreaterThan(0); // chunks + walls
    terrain.dispose();
    let after = 0;
    physics.world.forEachRigidBody(() => after++);
    expect(after).toBe(0);
  });

  it("dispose is idempotent", () => {
    const { terrain } = makeTerrain();
    terrain.dispose();
    expect(() => terrain.dispose()).not.toThrow();
  });

  it("update(cameras) does not throw and is no-op-safe after dispose", () => {
    const { terrain } = makeTerrain();
    expect(() => terrain.update([{ x: 0, y: 0, z: 0 }])).not.toThrow();
    terrain.dispose();
    expect(() => terrain.update([{ x: 0, y: 0, z: 0 }])).not.toThrow();
  });
});
