import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TerrainChunkManager } from "./TerrainChunkManager";
import { desiredChunks } from "./streamGrid";
import type { HeightSource } from "./heightSource";
import type { Pt } from "../kart/kartLod";

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
    normalAt: (_x, _z, out = [0, 0, 0]) => {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    },
  };
}

function bodyCount(p: PhysicsWorld): number {
  let n = 0;
  p.world.forEachRigidBody(() => n++);
  return n;
}

/** Chunk center (XZ) recovered from a mesh's geometry bounding box. */
function meshCenterXZ(mesh: THREE.Mesh): { x: number; z: number } {
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox!;
  return { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 };
}

function hasChunkAt(mgr: TerrainChunkManager, x: number, z: number): boolean {
  for (const child of mgr.group.children) {
    const c = meshCenterXZ(child as THREE.Mesh);
    if (Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6) return true;
  }
  return false;
}

/** Sorted "x,z" center keys for every active chunk mesh (set comparison). */
function centerKeys(mgr: TerrainChunkManager): string[] {
  return (mgr.group.children as THREE.Mesh[])
    .map((m) => {
      const c = meshCenterXZ(m);
      return `${c.x.toFixed(3)},${c.z.toFixed(3)}`;
    })
    .sort();
}

/**
 * worldSize 40, gridCount 2 -> chunkSize 20. streamRadius 25 seeds the origin
 * plus-shape (5 chunks: (0,0) + (±20,0)/(0,±20)); cullRadius 35 gives
 * hysteresis; maxActivations 99 so streaming is not throttle-limited.
 */
const CFG = {
  worldSize: 40,
  gridCount: 2,
  streamRadius: 25,
  cullRadius: 35,
  maxActivations: 99,
} as const;
const CHUNK = CFG.worldSize / CFG.gridCount;
const SEED = desiredChunks([{ x: 0, y: 0, z: 0 }], CFG.streamRadius, CHUNK).size;

const ORIGIN: Pt = { x: 0, y: 0, z: 0 };

/**
 * 206 incremental ctor seed. A finite seedBudget spreads the origin seed over
 * frames: the ctor builds only the nearest `seedBudget` chunks and update()
 * drains the rest (nearest-camera-first) per frame; primeSeed force-seeds the
 * spawn region. Default Infinity reproduces the pre-206 synchronous full seed.
 */
describe("TerrainChunkManager incremental seed (206)", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("default Infinity budget seeds the whole origin ring synchronously", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    expect(mgr.activeCount).toBe(SEED);
    expect(mgr.pendingCount).toBe(0);
    mgr.dispose();
  });

  it("ctor seeds only seedBudget chunks and enqueues the rest", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, seedBudget: 1 });
    // Only the nearest-to-origin chunk (0,0) seeds now; the four axis chunks pend.
    expect(mgr.activeCount).toBe(1);
    expect(mgr.group.children.length).toBe(1);
    expect(bodyCount(physics)).toBe(1);
    expect(mgr.pendingCount).toBe(SEED - 1);
    expect(hasChunkAt(mgr, 0, 0)).toBe(true);
    mgr.dispose();
  });

  it("update() drains the pending seed over frames to full parity", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, seedBudget: 1 });
    // Budget 1 -> each update adds at most one seeded chunk until the queue drains.
    let guard = 0;
    while (mgr.pendingCount > 0 && guard++ < 50) mgr.update([ORIGIN]);
    expect(mgr.pendingCount).toBe(0);
    expect(mgr.activeCount).toBe(SEED);
    expect(bodyCount(physics)).toBe(SEED);
    // Eventual chunk set matches the synchronous (Infinity-budget) seed.
    const sync = new TerrainChunkManager(new PhysicsWorld(-24), flatSrc(), CFG);
    expect(centerKeys(mgr)).toEqual(centerKeys(sync));
    // Draining is idempotent once empty.
    mgr.update([ORIGIN]);
    expect(mgr.activeCount).toBe(SEED);
    sync.dispose();
    mgr.dispose();
  });

  it("drain activates the pending chunk nearest the camera first", () => {
    const physics = new PhysicsWorld(-24);
    // maxActivations 0 isolates drainSeed from the planStream activation path;
    // cullRadius 1000 keeps every chunk so nothing is culled during the probe.
    const cfg = {
      ...CFG,
      cullRadius: 1000,
      maxActivations: 0,
      seedBudget: 1,
    } as const;
    const mgr = new TerrainChunkManager(physics, flatSrc(), cfg);
    // Pending: (±20,0),(0,±20). Camera at (20,0,0): nearest pending is (20,0) d0;
    // (-20,0) is d40 (farthest) -> not drained under budget 1 this frame.
    mgr.update([{ x: 20, y: 0, z: 0 }]);
    expect(mgr.activeCount).toBe(2);
    expect(hasChunkAt(mgr, 20, 0)).toBe(true);
    expect(hasChunkAt(mgr, -20, 0)).toBe(false);
    expect(mgr.pendingCount).toBe(SEED - 2);
    mgr.dispose();
  });

  it("primeSeed force-seeds deferred chunks within radius of a focus + collider", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(0), { ...CFG, seedBudget: 1 });
    // Focus on chunk (20,0) center: it seeds now (dist 0 <= 5); the others (dist
    // >= 20) stay pending. Default colliderRadius Infinity -> primed chunk gets a
    // collider, so a downward ray at (20,0) hits the surface before any update().
    mgr.primeSeed([{ x: 20, y: 0, z: 0 }], 5);
    expect(hasChunkAt(mgr, 20, 0)).toBe(true);
    expect(hasChunkAt(mgr, 0, 20)).toBe(false);
    expect(mgr.pendingCount).toBe(SEED - 2);
    expect(bodyCount(physics)).toBe(2);
    physics.step();
    const ray = new RAPIER.Ray({ x: 20, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(physics.world.castRayAndGetNormal(ray, 200, true)).not.toBeNull();
    mgr.dispose();
  });

  it("primeSeed is a no-op with an empty queue and after dispose", () => {
    const physics = new PhysicsWorld(-24);
    // Infinity seed -> nothing pending; primeSeed changes nothing.
    const full = new TerrainChunkManager(physics, flatSrc(), CFG);
    full.primeSeed([ORIGIN], 100);
    expect(full.activeCount).toBe(SEED);
    full.dispose();
    expect(() => full.primeSeed([ORIGIN], 100)).not.toThrow();
    // Disposed incremental manager ignores primeSeed.
    const inc = new TerrainChunkManager(new PhysicsWorld(-24), flatSrc(), {
      ...CFG,
      seedBudget: 1,
    });
    inc.dispose();
    expect(() => inc.primeSeed([ORIGIN], 100)).not.toThrow();
  });
});
