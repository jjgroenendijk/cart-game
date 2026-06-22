import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "./Terrain";

// Rapier wasm must init before any World/collider construction.
let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/** Small fast terrain (40m, 20 cells) for unit tests. The standard track
 * (radius ~60) sits outside this world, so every sample is full-weight
 * off-track -> heightAt is a smooth deterministic field, ideal for the
 * raycast orientation check. */
function makeTerrain(override: { segments?: number; worldSize?: number } = {}) {
  const physics = new PhysicsWorld(-24);
  const terrain = new Terrain(physics, {
    worldSize: override.worldSize ?? 40,
    segments: override.segments ?? 20,
    cacheCell: 2,
    config: { noiseSeed: 1 },
  });
  return { physics, terrain };
}

describe("Terrain", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("mesh has (segments+1)^2 vertices and a matching RGB color attribute", () => {
    const { terrain } = makeTerrain({ segments: 20 });
    const geo = terrain.mesh.geometry as THREE.PlaneGeometry;
    const verts = (20 + 1) * (20 + 1);
    expect(geo.attributes.position.count).toBe(verts);
    const col = geo.attributes.color as THREE.BufferAttribute;
    expect(col).toBeTruthy();
    expect(col.itemSize).toBe(3);
    expect(col.count).toBe(verts);
  });

  it("mesh lives on render layer 1 (post Sobel, no inverted hull)", () => {
    const { terrain } = makeTerrain();
    expect(terrain.mesh.layers.isEnabled(1)).toBe(true);
    expect(terrain.mesh.layers.isEnabled(0)).toBe(false);
  });

  it("uses a vertexColors CelMaterial (VERTEX_COLORS define set)", () => {
    const { terrain } = makeTerrain();
    const mat = terrain.mesh.material as THREE.ShaderMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.defines.VERTEX_COLORS).toBe("");
  });

  it("collider is a trimesh (heightfield rays are unreliable in Rapier 0.14)", () => {
    const { terrain } = makeTerrain();
    const shape = terrain.collider.shape;
    expect(shape).toBeTruthy();
    expect(shape?.type).toBe(RAPIER.ShapeType.TriMesh);
  });

  it("collider surface matches heightAt everywhere (raycast orientation guard)", () => {
    // Collider trimesh shares the mesh vertex buffer, which samples heightAt;
    // a winding/transpose error would show as misses or large height error.
    const { physics, terrain } = makeTerrain({ segments: 20, worldSize: 40 });
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
  });

  it("startPos + startYaw delegate to the spline", () => {
    const { terrain } = makeTerrain();
    const p = terrain.startPos();
    expect(p.distanceTo(terrain.spline.startPos())).toBeLessThan(1e-6);
    expect(terrain.startYaw()).toBe(terrain.spline.startYaw());
  });

  it("normalAt returns a unit-length upward-facing vector", () => {
    const { terrain } = makeTerrain();
    const n = terrain.normalAt(0, 0);
    expect(n.length()).toBeCloseTo(1, 5);
    expect(n.y).toBeGreaterThan(0.5);
  });
});
