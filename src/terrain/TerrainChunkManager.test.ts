import { describe, expect, it, beforeAll, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TerrainChunkManager } from "./TerrainChunkManager";
import type { HeightSource } from "./heightSource";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/** Flat stub HeightSource: every sample returns height h, a fixed color. */
function flatSrc(h = 0): HeightSource {
  return {
    heightAt: () => h,
    colorAt: (_x, _z, out = [0, 0, 0]) => out,
  };
}

function bodyCount(p: PhysicsWorld): number {
  let n = 0;
  p.world.forEachRigidBody(() => n++);
  return n;
}

/** Small grid so the suite is fast: 40m / 2 = 4 chunks of 20m each. */
const SMALL = { worldSize: 40, gridCount: 2 } as const;
const CHUNKS = SMALL.gridCount * SMALL.gridCount;

describe("TerrainChunkManager", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("ctor activates all in-world chunks", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    expect(mgr.activeCount).toBe(CHUNKS);
    expect(mgr.group.children.length).toBe(CHUNKS);
    expect(bodyCount(physics)).toBe(CHUNKS);
    mgr.dispose();
  });

  it("chunk meshes are layer 1 + receiveShadow + share one CelMaterial", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    const meshes = mgr.group.children as THREE.Mesh[];
    expect(meshes.length).toBe(CHUNKS);
    const mats = new Set<THREE.Material>();
    for (const m of meshes) {
      expect(m.layers.isEnabled(1)).toBe(true);
      expect(m.layers.isEnabled(0)).toBe(false);
      expect(m.receiveShadow).toBe(true);
      const mat = m.material as THREE.ShaderMaterial;
      expect(mat.vertexColors).toBe(true);
      expect(mat.defines.VERTEX_COLORS).toBe("");
      mats.add(mat);
    }
    expect(mats.size).toBe(1);
    mgr.dispose();
  });

  it("collider is a trimesh per chunk (raycast hits the surface)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(0), SMALL);
    expect(bodyCount(physics)).toBe(mgr.activeCount);
    physics.step();
    const ray = new RAPIER.Ray({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    const hit = physics.world.castRayAndGetNormal(ray, 200, true);
    expect(hit).not.toBeNull();
    if (hit) {
      const surfaceY = 100 - hit.timeOfImpact;
      expect(Math.abs(surfaceY)).toBeLessThan(0.5);
    }
    mgr.dispose();
  });

  it("deactivate removes the mesh + body", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    expect(mgr.activeCount).toBe(CHUNKS);
    mgr.deactivate(0, 0);
    expect(mgr.activeCount).toBe(CHUNKS - 1);
    expect(mgr.group.children.length).toBe(CHUNKS - 1);
    expect(bodyCount(physics)).toBe(CHUNKS - 1);
    mgr.dispose();
  });

  it("activate re-adds a deactivated chunk", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    mgr.deactivate(0, 0);
    expect(mgr.activeCount).toBe(CHUNKS - 1);
    mgr.activate(0, 0);
    expect(mgr.activeCount).toBe(CHUNKS);
    expect(mgr.group.children.length).toBe(CHUNKS);
    expect(bodyCount(physics)).toBe(CHUNKS);
    mgr.dispose();
  });

  it("update(cameras) rebuilds on tier change only", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    const mesh0 = mgr.group.children[0] as THREE.Mesh;
    const before = mesh0.geometry.attributes.position.count;

    const createSpy = vi.spyOn(physics.world, "createRigidBody");
    const removeSpy = vi.spyOn(physics.world, "removeRigidBody");

    mgr.update([{ x: 9999, y: 9999, z: 9999 }]);
    const after = mesh0.geometry.attributes.position.count;
    expect(after).toBeLessThan(before);
    expect(createSpy.mock.calls.length).toBeGreaterThan(0);
    expect(removeSpy.mock.calls.length).toBeGreaterThan(0);
    const createCallsAfterFar = createSpy.mock.calls.length;

    mgr.update([{ x: 9999, y: 9999, z: 9999 }]);
    expect(createSpy.mock.calls.length).toBe(createCallsAfterFar);

    mgr.update([{ x: 0, y: 0, z: 0 }]);
    expect(mesh0.geometry.attributes.position.count).toBeGreaterThan(after);

    createSpy.mockRestore();
    removeSpy.mockRestore();
    mgr.dispose();
  });

  it("hysteresis holds tier across an update inside the hysteresis band", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    const createSpy = vi.spyOn(physics.world, "createRigidBody");
    // Camera at (50,0,0): nearest chunk center dist ~41 (< near 50), farthest
    // ~61 (past near 50 but inside near+hys 75). All start "near"; hysteresis
    // holds near -> no rebuild -> no new bodies.
    mgr.update([{ x: 50, y: 0, z: 0 }]);
    expect(createSpy.mock.calls.length).toBe(0);
    createSpy.mockRestore();
    mgr.dispose();
  });

  it("dispose removes all bodies + clears the group", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    expect(mgr.activeCount).toBe(CHUNKS);
    mgr.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(mgr.group.children.length).toBe(0);
    expect(mgr.activeCount).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    mgr.dispose();
    expect(() => mgr.dispose()).not.toThrow();
    expect(bodyCount(physics)).toBe(0);
  });

  it("update after dispose is a no-op", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), SMALL);
    mgr.dispose();
    expect(() => mgr.update([{ x: 0, y: 0, z: 0 }])).not.toThrow();
  });
});
