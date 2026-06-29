import { describe, expect, it, beforeAll, vi } from "vitest";
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

/**
 * Chunk center (XZ) recovered from a mesh's geometry bounding box. Geometry
 * positions are authored in world space, so the box center is the chunk center
 * regardless of mesh.position.
 */
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

/**
 * Small deterministic streaming config. worldSize 40, gridCount 2 ->
 * chunkSize 20. streamRadius 25 seeds the origin plus-shape (centers within
 * 25: (0,0) d0 + (±20,0)/(0,±20) d20 -> 5 chunks; corners d≈28.3 excluded).
 * cullRadius 35 gives 10m hysteresis past streamRadius. maxActivations 99 so
 * the seed + streaming tests are not throttle-limited unless overridden.
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

/**
 * Single-chunk config for tier-change tests. streamRadius 4 seeds only chunk
 * (0,0); cullRadius 100 keeps it active at any test camera distance; custom
 * LOD (near 5, mid 10, hys 2) so camera at (15,0,0) triggers near->far
 * without activating or culling any chunk.
 */
const TIER_CFG = {
  worldSize: 20,
  gridCount: 1,
  streamRadius: 4,
  cullRadius: 100,
  maxActivations: 99,
  lod: { near: 5, mid: 10, hysteresis: 2 },
} as const;

describe("TerrainChunkManager", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("ctor seeds chunks within streamRadius of origin", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    expect(mgr.activeCount).toBe(SEED);
    expect(mgr.group.children.length).toBe(SEED);
    expect(bodyCount(physics)).toBe(SEED);
    // Origin chunk is in the seed (center dist 0).
    expect(hasChunkAt(mgr, 0, 0)).toBe(true);
    mgr.dispose();
  });

  it("two-material cel split: near chunk HEIGHT_MAP, far chunks vertex normals", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const meshes = mgr.group.children as THREE.Mesh[];
    // Only chunk (0,0) (bounds [-10,10]) is inside worldSize [-20,20]; the
    // four axis chunks reach ±30 -> far (vertex normals, no HEIGHT_MAP).
    const mats = new Set<THREE.Material>();
    let nearCount = 0;
    for (const m of meshes) {
      const mat = m.material as THREE.ShaderMaterial;
      mats.add(mat);
      const c = meshCenterXZ(m);
      const isNear = Math.abs(c.x) < 1e-6 && Math.abs(c.z) < 1e-6;
      if (isNear) {
        expect(mat.defines.HEIGHT_MAP).toBe("");
        nearCount++;
      } else {
        expect(mat.defines.HEIGHT_MAP).toBeUndefined();
      }
    }
    expect(nearCount).toBe(1);
    expect(mats.size).toBe(2);
    mgr.dispose();
  });

  it("chunk meshes are layer 1, receiveShadow, vertexColors", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const meshes = mgr.group.children as THREE.Mesh[];
    expect(meshes.length).toBe(SEED);
    for (const m of meshes) {
      expect(m.layers.isEnabled(1)).toBe(true);
      expect(m.layers.isEnabled(0)).toBe(false);
      expect(m.receiveShadow).toBe(true);
      const mat = m.material as THREE.ShaderMaterial;
      expect(mat.vertexColors).toBe(true);
      expect(mat.defines.VERTEX_COLORS).toBe("");
    }
    mgr.dispose();
  });

  it("chunk geometry carries a world-consistent normal attribute", () => {
    // Normals come from the HeightSource (not computeVertexNormals): flat src
    // -> every normal is straight up, count matches position count.
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(0), CFG);
    for (const child of mgr.group.children) {
      const geo = (child as THREE.Mesh).geometry;
      const normal = geo.getAttribute("normal");
      expect(normal).toBeTruthy();
      expect(normal.count).toBe(geo.getAttribute("position").count);
      for (let i = 1; i < normal.count * 3; i += 3) {
        expect(normal.array[i]).toBeCloseTo(1, 6);
      }
    }
    mgr.dispose();
  });

  it("near material binds the per-pixel heightmap (HEIGHT_MAP + texture)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(0), { ...CFG, heightTexels: 16 });
    let nearMat: THREE.ShaderMaterial | null = null;
    for (const child of mgr.group.children) {
      const m = (child as THREE.Mesh).material as THREE.ShaderMaterial;
      if (m.defines.HEIGHT_MAP === "") nearMat = m;
    }
    expect(nearMat).not.toBeNull();
    const tex = nearMat!.uniforms.uHeightMap.value as THREE.DataTexture;
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.image.width).toBe(16);
    expect(tex.image.height).toBe(16);
    // 16 texels over 40 m world -> 2.5 m/texel.
    expect(nearMat!.uniforms.uHeightTexelWorld.value).toBeCloseTo(40 / 16, 6);
    mgr.dispose();
  });

  it("collider is a trimesh per chunk (raycast hits the surface)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(0), CFG);
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

  it("streaming activates near a moved camera and culls the origin ring", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    expect(mgr.activeCount).toBe(SEED);
    // Camera to (40,40): origin chunk (0,0) center dist ≈56.6 > cullRadius 35
    // -> culled. Chunk (2,2) center (40,40) dist 0 <= streamRadius -> active.
    // The desired set around (40,40) is the same plus-shape as the seed.
    const cam: Pt = { x: 40, y: 0, z: 40 };
    mgr.update([cam]);
    const expected = desiredChunks([cam], CFG.streamRadius, CHUNK).size;
    expect(mgr.group.children.length).toBe(expected);
    expect(mgr.activeCount).toBe(expected);
    expect(hasChunkAt(mgr, 0, 0)).toBe(false);
    expect(hasChunkAt(mgr, 40, 40)).toBe(true);
    mgr.dispose();
  });

  it("cull hysteresis keeps a chunk between streamRadius and cullRadius", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    // Camera at (30,0): chunk (0,0) center dist 30 -> not desired (>25) but
    // inside cullRadius (<=35), so it STAYS active (hysteresis).
    mgr.update([{ x: 30, y: 0, z: 0 }]);
    expect(hasChunkAt(mgr, 0, 0)).toBe(true);
    mgr.dispose();
  });

  it("chunk beyond cullRadius is culled", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    // Camera at (45,0): chunk (0,0) center dist 45 > cullRadius 35 -> culled.
    mgr.update([{ x: 45, y: 0, z: 0 }]);
    expect(hasChunkAt(mgr, 0, 0)).toBe(false);
    mgr.dispose();
  });

  it("maxActivations throttles new chunk bodies per update", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, maxActivations: 1 });
    // Spy AFTER ctor (ctor seed is not throttle-limited). Move to a fresh far
    // location so the whole origin ring is culled and a fresh ring is desired.
    const createSpy = vi.spyOn(physics.world, "createRigidBody");
    mgr.update([{ x: 200, y: 0, z: 200 }]);
    expect(createSpy.mock.calls.length).toBe(1);
    createSpy.mockRestore();
    mgr.dispose();
  });

  it("manual deactivate + activate round-trip still works", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const before = mgr.activeCount;
    mgr.deactivate(0, 0);
    expect(mgr.activeCount).toBe(before - 1);
    expect(mgr.group.children.length).toBe(before - 1);
    expect(bodyCount(physics)).toBe(before - 1);
    mgr.activate(0, 0);
    expect(mgr.activeCount).toBe(before);
    expect(mgr.group.children.length).toBe(before);
    expect(bodyCount(physics)).toBe(before);
    mgr.dispose();
  });

  it("update(cameras) toggles collider + swaps mesh on tier change", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), TIER_CFG);
    const mesh0 = mgr.group.children[0] as THREE.Mesh;
    const before = mesh0.geometry.attributes.position.count;

    const createBodySpy = vi.spyOn(physics.world, "createRigidBody");
    const removeBodySpy = vi.spyOn(physics.world, "removeRigidBody");
    const createColliderSpy = vi.spyOn(physics.world, "createCollider");
    const bodiesAtStart = bodyCount(physics);

    mgr.update([{ x: 15, y: 0, z: 0 }]);
    const after = mesh0.geometry.attributes.position.count;
    expect(after).toBeLessThan(before);
    expect(createBodySpy.mock.calls.length).toBe(0);
    expect(removeBodySpy.mock.calls.length).toBe(0);
    expect(bodyCount(physics)).toBe(bodiesAtStart);
    expect(createColliderSpy.mock.calls.length).toBeGreaterThan(0);
    const createColliderAfterFar = createColliderSpy.mock.calls.length;

    mgr.update([{ x: 15, y: 0, z: 0 }]);
    expect(createColliderSpy.mock.calls.length).toBe(createColliderAfterFar);
    expect(bodyCount(physics)).toBe(bodiesAtStart);

    mgr.update([{ x: 0, y: 0, z: 0 }]);
    expect(mesh0.geometry.attributes.position.count).toBeGreaterThan(after);
    expect(createBodySpy.mock.calls.length).toBe(0);
    expect(removeBodySpy.mock.calls.length).toBe(0);
    expect(createColliderSpy.mock.calls.length).toBe(createColliderAfterFar);

    createBodySpy.mockRestore();
    removeBodySpy.mockRestore();
    createColliderSpy.mockRestore();
    mgr.dispose();
  });

  it("hysteresis holds tier across an update inside the hysteresis band", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), TIER_CFG);
    const createSpy = vi.spyOn(physics.world, "createRigidBody");
    mgr.update([{ x: 6, y: 0, z: 0 }]);
    expect(createSpy.mock.calls.length).toBe(0);
    createSpy.mockRestore();
    mgr.dispose();
  });

  it("dispose removes all bodies + clears the group", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    expect(mgr.activeCount).toBe(SEED);
    mgr.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(mgr.group.children.length).toBe(0);
    expect(mgr.activeCount).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    mgr.dispose();
    expect(() => mgr.dispose()).not.toThrow();
    expect(bodyCount(physics)).toBe(0);
  });

  it("update after dispose is a no-op", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    mgr.dispose();
    expect(() => mgr.update([{ x: 0, y: 0, z: 0 }])).not.toThrow();
  });
});
