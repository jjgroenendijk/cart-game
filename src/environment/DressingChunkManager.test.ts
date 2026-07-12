import { describe, expect, it, beforeAll, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import {
  DressingChunkManager,
  stepFade,
  type DressingChunkManagerOptions,
} from "./DressingChunkManager";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import type { Pt } from "../kart/kartLod";

/** All uFade uniform values under `group` (big-prop buckets + outlines). */
function fadeValues(group: THREE.Group): number[] {
  const vals: number[] = [];
  group.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    const u = mat?.uniforms?.uFade;
    if (u) vals.push(u.value as number);
  });
  return vals;
}

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
    corridorClearance: () => 1000,
  };
}

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

const layers: PropLayer[] = [
  { kind: "tree", count: 3, minScale: 0.8, maxScale: 1.2, maxSlope: 0.6 },
  { kind: "rock", count: 3, minScale: 0.8, maxScale: 1.2, maxSlope: 0.6 },
  { kind: "bush", count: 5, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
  { kind: "flower", count: 10, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
  { kind: "grass", count: 15, minScale: 0.8, maxScale: 1.2, maxSlope: 1.0 },
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
    dcm.update([far], 10);
    expect(dcm.activeCount).not.toBe(seedCount);
    dcm.update([far], 10);
    dcm.update([far], 10);
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
      dcm.update([f], 10);
      dcm.update([f], 10);
      expect(bodyCount(physics)).toBeLessThan(200);
    }
    dcm.dispose();
  });

  it("shared planner activates nearest-first under a tight budget", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), {
      ...defaultOpts(),
      maxActivations: 1,
    });
    // Focus offset from a chunk center (chunkSize 25): the nearest desired chunk
    // is (8,8) d≈5, but the row-major Set scan would reach (7,8) d≈25.5 first.
    // Budget 1 must spend on the NEAREST, proving the shared planner's ordering.
    const spy = vi.spyOn(dcm, "activate");
    dcm.update([{ x: 200, y: 0, z: 205 }], 10);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(8, 8);
    spy.mockRestore();
    dcm.dispose();
  });

  it("update with empty cameras is a no-op", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const count = dcm.activeCount;
    const bodies = bodyCount(physics);
    dcm.update([], 10);
    expect(dcm.activeCount).toBe(count);
    expect(bodyCount(physics)).toBe(bodies);
    dcm.dispose();
  });

  it("ctor seed ring is solid (fade 1), streamed activations dissolve in from 0", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const seeded = fadeValues(dcm.group);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((v) => v === 1)).toBe(true);
    // Jump the focus: new bundles activate dissolved, then ramp over updates.
    const far: Pt = { x: 200, y: 0, z: 0 };
    dcm.update([far], 0.15); // fadeSeconds 0.45 -> 1/3 per step
    expect(fadeValues(dcm.group)).toContain(0);
    dcm.update([far], 0.15);
    const mid = fadeValues(dcm.group);
    expect(mid.some((v) => v > 0 && v < 1)).toBe(true);
    for (let i = 0; i < 30; i++) dcm.update([far], 0.15);
    expect(fadeValues(dcm.group).every((v) => v === 1)).toBe(true);
    dcm.dispose();
  });

  it("culled bundles fade out before disposal; returning focus reverses the fade", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const spy = vi.spyOn(dcm, "deactivate");
    const far: Pt = { x: 200, y: 0, z: 0 };
    dcm.update([far], 0.15);
    // Origin bundles are past cullRadius but only part-faded -> not disposed.
    expect(spy).not.toHaveBeenCalled();
    // Focus returns before the fade-out completes -> origin bundles survive
    // (never deactivated) and ramp back to solid.
    const home: Pt = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) dcm.update([home], 0.15);
    expect(spy).not.toHaveBeenCalledWith(0, 0);
    expect(fadeValues(dcm.group).every((v) => v === 1)).toBe(true);
    spy.mockRestore();
    dcm.dispose();
  });

  it("fade-out completes -> culled bundle is deactivated (bodies freed)", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    const spy = vi.spyOn(dcm, "deactivate");
    const far: Pt = { x: 200, y: 0, z: 0 };
    dcm.update([far], 0.15);
    expect(spy).not.toHaveBeenCalled(); // mid-fade, still alive
    dcm.update([far], 10); // step >= remaining fade -> clamps to 0 -> deactivate
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
    dcm.dispose();
  });

  it("fadeSeconds 0 restores instant cull (pre-fade parity)", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), {
      ...defaultOpts(),
      fadeSeconds: 0,
    });
    const spy = vi.spyOn(dcm, "deactivate");
    dcm.update([{ x: 200, y: 0, z: 0 }], 0.001);
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
    dcm.dispose();
  });

  it("stepFade ramps toward the target and clamps there", () => {
    expect(stepFade(0, 1, 0.4)).toBeCloseTo(0.4, 9);
    expect(stepFade(0.8, 1, 0.4)).toBe(1);
    expect(stepFade(1, 0, 0.4)).toBeCloseTo(0.6, 9);
    expect(stepFade(0.2, 0, 0.4)).toBe(0);
    expect(stepFade(1, 1, 0.4)).toBe(1);
    expect(stepFade(0.5, 1, 0)).toBe(0.5);
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
