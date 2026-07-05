import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "./Terrain";
import { desiredChunks } from "./streamGrid";
import { generateCircuit } from "./circuit";

// Rapier wasm must init before any World/collider construction.
let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/** Count rigid bodies in a physics world (chunk trimeshes; walls are gone). */
function bodyCount(p: PhysicsWorld): number {
  let n = 0;
  p.world.forEachRigidBody(() => n++);
  return n;
}

/** Small fast terrain (40m, 4x4 chunks of 10m) for unit tests. The standard
 * track (radius ~60) sits outside this world, so every sample is full-weight
 * off-track -> heightAt is a smooth deterministic field, ideal for the
 * raycast + seam check. streamRadius 29 / cullRadius 40 keep the seed tiny
 * (default 140 would activate ~hundreds of chunks) while still covering the
 * [-16,16] ray sample region (chunkSize 10 -> centers within 29 reach ±20,
 * covering the (±16,±16) sample corners whose owning chunk center is d≈28.3). */
function makeTerrain(override: { gridCount?: number; worldSize?: number } = {}) {
  const physics = new PhysicsWorld(-24);
  const terrain = new Terrain(physics, {
    worldSize: override.worldSize ?? 40,
    gridCount: override.gridCount ?? 4,
    cacheCell: 2,
    config: { noiseSeed: 1 },
    streamRadius: 29,
    cullRadius: 40,
  });
  return { physics, terrain };
}

describe("Terrain", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("ctor seeds chunks within streamRadius of origin", () => {
    const { terrain } = makeTerrain({ gridCount: 4 });
    // chunkSize 10; seed = chunks within streamRadius 29 of origin.
    const seed = desiredChunks([{ x: 0, y: 0, z: 0 }], 29, 10).size;
    expect(terrain.chunks.activeCount).toBe(seed);
    expect(terrain.group.children.length).toBeGreaterThan(0);
    terrain.dispose();
  });

  it("no boundary wall: body count equals active chunk count", () => {
    // Wall is gone -> every rigid body is a chunk trimesh, nothing extra.
    const { physics, terrain } = makeTerrain();
    expect(bodyCount(physics)).toBe(terrain.chunks.activeCount);
    terrain.dispose();
  });

  it("chunked collider surface matches heightAt everywhere (raycast + seam guard)", () => {
    // Each chunk collider shares its verts with heightAt via the HeightSource;
    // a winding/coverage error would show as misses or large height error at a
    // chunk boundary. gridCount 4 over worldSize 40 -> 10m chunks; the signed
    // grid centers chunks at the origin, so the seg-25 vertex lattice lands on
    // ODD coordinates (cs/seg = 0.4). Sampling odd [-15,15] hits verts (error
    // ~0) AND the chunk boundaries ±5,±15 (the seam guard). heightAt now
    // delegates to the streaming source but is byte-identical in-bounds.
    const { physics, terrain } = makeTerrain({ gridCount: 4, worldSize: 40 });
    physics.step(); // broadphase must be built before raycasts hit
    const ray = new RAPIER.Ray({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    let misses = 0;
    let worst = 0;
    for (let z = -15; z <= 15; z += 2) {
      for (let x = -15; x <= 15; x += 2) {
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

  it("streamed colliders match heightAt beyond the cache (out-of-bounds parity)", () => {
    // Dedicated terrain whose cache covers [-20,20] (worldSize 40) but whose
    // streamRadius/cullRadius let chunks activate FAR outside it. Camera at
    // (45,45) -> chunks (4,4)/(5,5) (centers 40/50, well past worldHalf 20)
    // activate; their collider verts AND terrain.heightAt both resolve through
    // StreamingHeightSource's closestPoint path -> raycast surface == heightAt.
    // maxActivations 999 so one update fully activates the desired ring.
    const physics = new PhysicsWorld(-24);
    const terrain = new Terrain(physics, {
      worldSize: 40,
      gridCount: 4,
      cacheCell: 2,
      config: { noiseSeed: 1 },
      streamRadius: 60,
      cullRadius: 80,
      maxActivations: 999,
    });
    const cam = { x: 45, y: 0, z: 45 };
    // Settle streaming (3 calls): cull origin ring beyond cullRadius, activate
    // the desired ring around the camera.
    terrain.update([cam]);
    terrain.update([cam]);
    terrain.update([cam]);
    physics.step(); // broadphase must be built before raycasts hit
    const ray = new RAPIER.Ray({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 });
    let misses = 0;
    let worst = 0;
    for (let z = 40; z <= 50; z += 2) {
      for (let x = 40; x <= 50; x += 2) {
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
    // Headroom over the standalone runtime: the 5000-seed circuit sweep in
    // the parallel suite steals a worker, so 30 s flakes under contention.
  }, 120000);

  it("startPos + startYaw delegate to the spline", () => {
    const { terrain } = makeTerrain();
    const p = terrain.startPos();
    expect(p.distanceTo(terrain.spline.startPos())).toBeLessThan(1e-6);
    expect(terrain.startYaw()).toBe(terrain.spline.startYaw());
    terrain.dispose();
  });

  it("heightAt is finite + deterministic in-bounds", () => {
    const { terrain } = makeTerrain();
    const h1 = terrain.heightAt(5, -3);
    const h2 = terrain.heightAt(5, -3);
    expect(Number.isFinite(h1)).toBe(true);
    expect(h1).toBe(h2);
    terrain.dispose();
  });

  it("normalAt returns a unit-length upward-facing vector", () => {
    const { terrain } = makeTerrain();
    const n = terrain.normalAt(0, 0);
    expect(n.length()).toBeCloseTo(1, 5);
    expect(n.y).toBeGreaterThan(0.5);
    terrain.dispose();
  });

  it("waterLevel defaults to cfg.sandLevel; an explicit override wins", () => {
    const physics = new PhysicsWorld(-24);
    const tDefault = new Terrain(physics, {
      worldSize: 40,
      gridCount: 4,
      config: { sandLevel: 5 },
      streamRadius: 29,
      cullRadius: 40,
    });
    expect(tDefault.waterLevel).toBe(5);
    tDefault.dispose();

    const tOverride = new Terrain(physics, {
      worldSize: 40,
      gridCount: 4,
      config: { sandLevel: 5 },
      waterLevel: -999,
      streamRadius: 29,
      cullRadius: 40,
    });
    expect(tOverride.waterLevel).toBe(-999);
    tOverride.dispose();
  });

  it("dispose frees every chunk body (body count -> 0)", () => {
    const { physics, terrain } = makeTerrain();
    const before = bodyCount(physics);
    expect(before).toBeGreaterThan(0); // chunks only (no wall bodies)
    terrain.dispose();
    expect(bodyCount(physics)).toBe(0);
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

describe("Terrain — 057 scalable circuit bake", () => {
  // Large-circuit fixture (seed=34): 1035 m loop, worldSize ~394 -> bakes the
  // SplineFieldCache via the SampleIndex path over a world ~10x larger than
  // the 40 m unit worlds above.
  const SHOWCASE_SEED = 34;

  function makeShowcaseTerrain() {
    const circuit = generateCircuit(SHOWCASE_SEED);
    const physics = new PhysicsWorld(-24);
    const terrain = new Terrain(physics, {
      control: circuit.control,
      worldSize: circuit.worldSize,
      cacheCell: 2,
      config: { noiseSeed: 1 },
      streamRadius: 29,
      cullRadius: 40,
    });
    return { physics, terrain, circuit };
  }

  it("builds from generateCircuit; start height matches path; edge is finite", () => {
    const { terrain, circuit } = makeShowcaseTerrain();
    // Constructed without throwing (above); chunk meshes are present.
    expect(terrain.group.children.length).toBeGreaterThan(0);
    // On-road: heightAt == pathY (noise weight 0), so the bilinear cache of
    // the spline elevation tracks the start pose closely.
    const start = terrain.startPos();
    expect(Math.abs(terrain.heightAt(start.x, start.z) - start.y)).toBeLessThan(0.1);
    // Near the world edge (still in-bounds): bake must cover the larger world.
    const edge = circuit.worldSize / 2 - 5;
    expect(Number.isFinite(terrain.heightAt(edge, edge))).toBe(true);
    expect(Number.isFinite(terrain.heightAt(-edge, edge))).toBe(true);
    terrain.dispose();
  });
});
