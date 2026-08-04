import { describe, expect, it, beforeAll, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import {
  DressingChunkManager,
  stepFade,
  densityForBand,
  densityBandFor,
  type DressingChunkManagerOptions,
  type DensityBandParams,
} from "./DressingChunkManager";
import type { SamplerTerrain, PropLayer } from "./propSampler";
import type { Pt } from "../kart/kartLod";
import { EMISSIVE_LAYER } from "../materials/emissiveCapture";

/** Count layer-3 emissive clone meshes across all streamed bundle groups. */
function emissiveCloneCount(dcm: DressingChunkManager): number {
  let n = 0;
  for (const bundle of dcm.group.children) {
    for (const child of (bundle as THREE.Group).children) {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).layers.mask === 1 << EMISSIVE_LAYER)
        n++;
    }
  }
  return n;
}
import { type ImpostorAtlas } from "./ImpostorField";
import { impostorAtlasLayout } from "../materials/impostor";

/** Stub impostor atlas (no GPU bake) keyed by kind for the swap tests (200). */
function stubAtlas(kinds: string[]): ImpostorAtlas {
  const index = new Map(kinds.map((k, i) => [k, i]));
  return {
    albedo: new THREE.Texture(),
    normal: new THREE.Texture(),
    layout: impostorAtlasLayout(kinds.length),
    cells: kinds.map(() => ({ width: 3, height: 6 })),
    cellForKind: (k) => index.get(k) ?? -1,
    dispose: () => {},
  };
}

/** Count visible merged big-prop meshes (CelMaterial uFade + castShadow). */
function bigMeshesVisible(group: THREE.Group): number {
  let vis = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial | undefined;
    if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
      if (mat?.uniforms?.uFade && mesh.castShadow && mesh.visible) vis++;
    }
  });
  return vis;
}

/** Count shown impostor billboard fields (InstancedMesh with uAlbedo, parent visible). */
function cardsShown(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    const mat = im.material as THREE.ShaderMaterial | undefined;
    if (im.isInstancedMesh && mat?.uniforms?.uAlbedo && o.parent?.visible) n++;
  });
  return n;
}

/** All uFade uniform values under `group` (big-prop buckets). */
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

/** Sum of drawn decor instances (InstancedMesh.count) under `group`. */
function decorDrawn(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) n += im.count;
  });
  return n;
}

/** Sum of allocated decor instances (instanceMatrix.count) under `group`. */
function decorInstances(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) n += im.instanceMatrix.count;
  });
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

  it("setQuality reconciles big-prop emissive clones on a tier change (315)", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), defaultOpts());
    // Default tier "high": seed bundles have emissive clones.
    expect(emissiveCloneCount(dcm)).toBeGreaterThan(0);

    // low -> no clones across all existing bundles.
    dcm.setQuality("low");
    expect(emissiveCloneCount(dcm)).toBe(0);

    // high -> clones rebuilt on existing buckets.
    dcm.setQuality("high");
    expect(emissiveCloneCount(dcm)).toBeGreaterThan(0);

    // Same-tier call is idempotent (no-op, no churn).
    const before = emissiveCloneCount(dcm);
    dcm.setQuality("high");
    expect(emissiveCloneCount(dcm)).toBe(before);

    dcm.dispose();
  });

  it("tier:'low' option builds bundles without emissive clones", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), { ...defaultOpts(), tier: "low" });
    expect(emissiveCloneCount(dcm)).toBe(0);
    dcm.dispose();
  });
});

/**
 * 202 collider-range decoupling. streamRadius 80 streams props over a wide
 * ring; colliderRadius 15 keeps prop bodies to bundles near a kart focus,
 * colliderCullRadius 25 gives hysteresis. Visual bundles are unaffected.
 */
describe("DressingChunkManager collider-range decoupling (202)", () => {
  function decoupleOpts(): DressingChunkManagerOptions {
    return {
      ...defaultOpts(),
      streamRadius: 80,
      cullRadius: 90,
      colliderRadius: 15,
      colliderCullRadius: 25,
    };
  }

  it("bounded collider range spawns fewer bodies than the coupled default", () => {
    const physics = new PhysicsWorld(-24);
    const bounded = new DressingChunkManager(physics, stubTerrain(), decoupleOpts());
    const boundedBodies = bodyCount(physics);
    const boundedBundles = bounded.activeCount;
    expect(boundedBodies).toBeGreaterThan(0);

    const physics2 = new PhysicsWorld(-24);
    const coupled = new DressingChunkManager(physics2, stubTerrain(), {
      ...decoupleOpts(),
      colliderRadius: undefined,
      colliderCullRadius: undefined,
    });
    // Same visual stream (identical bundle count) but colliders everywhere.
    expect(coupled.activeCount).toBe(boundedBundles);
    expect(bodyCount(physics2)).toBeGreaterThan(boundedBodies);

    bounded.dispose();
    coupled.dispose();
  });

  it("refreshColliders far from every bundle frees all bodies; returning restores", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), decoupleOpts());
    expect(bodyCount(physics)).toBeGreaterThan(0);
    // No active bundle within colliderRadius of a distant focus -> bodies freed,
    // visuals (group children) untouched.
    const groupBefore = dcm.group.children.length;
    dcm.refreshColliders([{ x: 1000, y: 0, z: 0 }]);
    expect(bodyCount(physics)).toBe(0);
    expect(dcm.group.children.length).toBe(groupBefore);
    // Focus back over the origin bundles rebuilds their bodies.
    dcm.refreshColliders([{ x: 0, y: 0, z: 0 }]);
    expect(bodyCount(physics)).toBeGreaterThan(0);
    dcm.dispose();
  });

  it("refreshColliders is a no-op after dispose", () => {
    const physics = new PhysicsWorld(-24);
    const dcm = new DressingChunkManager(physics, stubTerrain(), decoupleOpts());
    dcm.dispose();
    expect(() => dcm.refreshColliders([{ x: 0, y: 0, z: 0 }])).not.toThrow();
  });
});

/** 201 distance density falloff for decor scatter. */
describe("density falloff helpers (201)", () => {
  const params: DensityBandParams = {
    nearRadius: 10,
    farRadius: 60,
    bands: 5,
    minDensity: 0.35,
    hysteresis: 2,
  };

  it("densityForBand maps band 0 -> full and band `bands` -> minDensity", () => {
    expect(densityForBand(0, params)).toBe(1);
    expect(densityForBand(5, params)).toBeCloseTo(0.35, 9);
    expect(densityForBand(2, params)).toBeCloseTo(0.74, 9); // 1 - (2/5)*0.65
    // Degenerate params disable thinning (full density everywhere).
    expect(densityForBand(3, { ...params, bands: 0 })).toBe(1);
  });

  it("densityBandFor clamps near/far and quantizes between", () => {
    expect(densityBandFor(5, 0, params)).toBe(0); // within near
    expect(densityBandFor(100, 0, params)).toBe(5); // past far
    expect(densityBandFor(35, 0, params)).toBe(2); // mid band
    // Degenerate (far <= near) -> band 0 (no falloff).
    expect(densityBandFor(35, 0, { ...params, farRadius: 5 })).toBe(0);
  });

  it("densityBandFor hysteresis holds the band on a boundary (no flap)", () => {
    // Boundary between band 1 and 2 sits at nearRadius + 2*width = 30. Inside
    // the ±hysteresis dead zone the resolved band follows the CURRENT band.
    expect(densityBandFor(30, 1, params)).toBe(1);
    expect(densityBandFor(30, 2, params)).toBe(2);
    // Clearing the boundary by more than hysteresis forces the step.
    expect(densityBandFor(33, 1, params)).toBe(2);
    expect(densityBandFor(27, 2, params)).toBe(1);
  });
});

describe("DressingChunkManager decor density falloff (201)", () => {
  it("thins seed-ring decor draw count vs the disabled default (same placement)", () => {
    // defaultOpts: streamRadius 30 -> nearRadius 15, farRadius = cull 40. Seed
    // chunks at ~25 m fall in a thinned band, so fewer decor instances draw
    // while the allocated instance buffers are identical (placement untouched).
    const on = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), defaultOpts());
    const off = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), {
      ...defaultOpts(),
      densityMin: 1, // disable falloff (pre-201 behavior)
    });
    expect(decorInstances(on.group)).toBe(decorInstances(off.group));
    expect(decorDrawn(on.group)).toBeLessThan(decorDrawn(off.group));
    expect(decorDrawn(off.group)).toBe(decorInstances(off.group)); // disabled = full
    expect(decorDrawn(on.group)).toBeGreaterThan(0);
    on.dispose();
    off.dispose();
  });

  it("update re-bands: pulling the focus in thickens previously-thinned decor", () => {
    const dcm = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), defaultOpts());
    // Focus sitting on a seed chunk's center (25,0): its own decor is full, but
    // the manager keeps the whole ring; total drawn rises as more chunks near
    // the new focus reach full density.
    const before = decorDrawn(dcm.group);
    dcm.update([{ x: 25, y: 0, z: 0 }], 0.001);
    expect(decorDrawn(dcm.group)).toBeGreaterThanOrEqual(before);
    // Never exceeds the allocated instances (density capped at 1).
    expect(decorDrawn(dcm.group)).toBeLessThanOrEqual(decorInstances(dcm.group));
    dcm.dispose();
  });

  it("disabled falloff leaves every bundle at full decor across streaming", () => {
    const dcm = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), {
      ...defaultOpts(),
      densityMin: 1,
    });
    for (const f of [
      { x: 0, y: 0, z: 0 },
      { x: 40, y: 0, z: 0 },
    ]) {
      dcm.update([f], 10);
      expect(decorDrawn(dcm.group)).toBe(decorInstances(dcm.group));
    }
    dcm.dispose();
  });

  it("no impostorAtlas => big meshes always shown, no cards (200 parity)", () => {
    const dcm = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), defaultOpts());
    expect(bigMeshesVisible(dcm.group)).toBeGreaterThan(0);
    expect(cardsShown(dcm.group)).toBe(0);
    dcm.dispose();
  });

  it("impostorStartRadius=0 swaps every big mesh for billboard cards (200)", () => {
    const dcm = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), {
      ...defaultOpts(),
      impostorAtlas: stubAtlas(["tree", "rock"]),
      impostorStartRadius: 0,
    });
    // Every seeded bundle is past a 0 start radius, so all big meshes hide and
    // their billboard fields show instead.
    expect(bigMeshesVisible(dcm.group)).toBe(0);
    expect(cardsShown(dcm.group)).toBeGreaterThan(0);
    dcm.dispose();
  });

  it("far start radius keeps near bundles on full 3D meshes (200)", () => {
    const dcm = new DressingChunkManager(new PhysicsWorld(-24), stubTerrain(), {
      ...defaultOpts(),
      impostorAtlas: stubAtlas(["tree", "rock"]),
      impostorStartRadius: 1000,
    });
    dcm.update([{ x: 0, y: 0, z: 0 }], 0.001);
    expect(bigMeshesVisible(dcm.group)).toBeGreaterThan(0);
    expect(cardsShown(dcm.group)).toBe(0);
    dcm.dispose();
  });
});
