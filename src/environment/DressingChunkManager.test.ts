import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { DressingChunkManager, type DressingChunkManagerOptions } from "./DressingChunkManager";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import type { Pt } from "../kart/kartLod";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/**
 * Flat stub terrain where EVERY candidate passes (spline dist huge, spawn far,
 * slope flat) so per-chunk body counts are deterministic without a real mesh.
 */
function stubTerrain(): SamplerTerrain {
  return {
    heightAt: () => 0,
    normalAt: (_x, _z, out = new THREE.Vector3()) => out.set(0, 1, 0),
    startPos: (out = new THREE.Vector3()) => out.set(1000, 0, 1000),
    spline: { closestPoint: () => ({ dist: 1000 }) },
  };
}

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

const layers: PropLayer[] = [
  { type: "tree", count: 3, minScale: 0.8, maxScale: 1.2, maxSlope: 0.6 },
  { type: "rock", count: 3, minScale: 0.8, maxScale: 1.2, maxSlope: 0.6 },
  { type: "bush", count: 5, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
  { type: "flower", count: 10, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
  { type: "grass", count: 15, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
];

function defaultOpts(): DressingChunkManagerOptions {
  return {
    chunkSize: 25,
    streamRadius: 30,
    cullRadius: 40,
    maxActivations: 4,
    baseSeed: 42,
    layers,
    sampler: {
      cell: 6,
      maxAttemptsPerCell: 4,
      trackHalfWidth: 6,
      corridorMargin: 3,
      spawnExclusionRadius: 12,
      maxSlope: 0.6,
    },
  };
}

describe("DressingChunkManager", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("ctor seeds bundles within streamRadius of origin", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    expect(dcm.activeCount).toBeGreaterThan(0);
    expect(dcm.group.children.length).toBeGreaterThan(0);
    dcm.dispose();
  });

  it("each bundle contributes prop bodies", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    expect(bodyCount(physics)).toBeGreaterThan(0);
    dcm.dispose();
  });

  it("activate builds a bundle; deactivate frees bodies", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const before = bodyCount(physics);
    const startCount = dcm.activeCount;
    expect(before).toBeGreaterThan(0);
    dcm.deactivate(0, 0);
    expect(dcm.activeCount).toBe(startCount - 1);
    expect(bodyCount(physics)).toBeLessThan(before);
    dcm.dispose();
  });

  it("deterministic re-activate reproduces placement", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    dcm.activate(5, 5);
    const afterFirst = bodyCount(physics);
    expect(afterFirst).toBeGreaterThan(0);
    dcm.deactivate(5, 5);
    expect(bodyCount(physics)).toBeLessThan(afterFirst);
    dcm.activate(5, 5);
    expect(bodyCount(physics)).toBe(afterFirst);
    dcm.dispose();
  });

  it("update streams: origin chunks cull when focus moves far", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const seedCount = dcm.activeCount;
    expect(seedCount).toBeGreaterThan(0);
    expect(bodyCount(physics)).toBeGreaterThan(0);
    const far: Pt = { x: 200, y: 0, z: 0 };
    dcm.update([far]);
    expect(dcm.activeCount).not.toBe(seedCount);
    dcm.update([far]);
    dcm.update([far]);
    expect(dcm.activeCount).toBeGreaterThan(0);
    expect(bodyCount(physics)).toBeLessThan(200);
    dcm.dispose();
  });

  it("body count bounded while roaming", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const foci: Pt[] = [
      { x: 0, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 150, y: 0, z: 0 },
    ];
    for (const f of foci) {
      dcm.update([f]);
      dcm.update([f]);
      expect(bodyCount(physics)).toBeLessThan(200);
    }
    dcm.dispose();
  });

  it("update with empty cameras is a no-op", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const count = dcm.activeCount;
    const bodies = bodyCount(physics);
    dcm.update([]);
    expect(dcm.activeCount).toBe(count);
    expect(bodyCount(physics)).toBe(bodies);
    dcm.dispose();
  });

  it("dispose frees all bodies and clears group", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    expect(bodyCount(physics)).toBeGreaterThan(0);
    expect(dcm.group.children.length).toBeGreaterThan(0);
    dcm.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(dcm.group.children.length).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    dcm.dispose();
    expect(() => dcm.dispose()).not.toThrow();
  });
});
