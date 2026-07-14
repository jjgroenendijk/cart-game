import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TerrainChunkManager } from "./TerrainChunkManager";
import type { HeightSource } from "./heightSource";

beforeAll(async () => {
  await RAPIER.init();
});

/** Flat stub HeightSource (mirrors TerrainChunkManager.test.ts). */
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
 * Single chunk (0,0); custom LOD (near 5, mid 10, hys 2) so a camera at
 * (15,0,0) drives near->far without activating or culling any chunk.
 * cullRadius 100 keeps it active at that distance.
 */
const TIER_CFG = {
  worldSize: 20,
  gridCount: 1,
  streamRadius: 4,
  cullRadius: 100,
  maxActivations: 99,
  lod: { near: 5, mid: 10, hysteresis: 2 },
} as const;

describe("TerrainChunkManager LOD cross-fade (198)", () => {
  /** TIER_CFG + a cross-fade duration and an injectable seconds clock. */
  function xfadeMgr(clock: { t: number }, over: Record<string, unknown> = {}) {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), {
      ...TIER_CFG,
      crossFadeSeconds: 1,
      now: () => clock.t,
      ...over,
    });
    return { physics, mgr };
  }

  it("tier swap keeps old + new mesh dissolving, then settles to the new tier", () => {
    const clock = { t: 0 };
    const { mgr } = xfadeMgr(clock);
    const mesh0 = mgr.group.children[0] as THREE.Mesh;
    const nearVerts = mesh0.geometry.attributes.position.count;

    // Camera to (15,0,0): chunk (0,0) goes near->far (no activate/cull). Small
    // dt keeps the fade partial so both tiers are live this frame.
    clock.t = 0.02;
    mgr.update([{ x: 15, y: 0, z: 0 }]);

    expect(mgr.group.children.length).toBe(2);
    const meshes = mgr.group.children as THREE.Mesh[];
    const oldMesh = meshes.find((m) => m === mesh0)!;
    const newMesh = meshes.find((m) => m !== mesh0)!;
    const oldMat = oldMesh.material as THREE.ShaderMaterial;
    const newMat = newMesh.material as THREE.ShaderMaterial;
    // New tier has fewer verts (far seg < near seg on high quality).
    expect(newMesh.geometry.attributes.position.count).toBeLessThan(nearVerts);
    // Complementary dither: old inverse discard, new normal discard, one uFade=t.
    expect(oldMat.fragmentShader).toContain("<= uFade) discard");
    expect(newMat.fragmentShader).toContain("> uFade) discard");
    expect(oldMat.uniforms.uFade.value).toBeCloseTo(0.02, 6);
    expect(newMat.uniforms.uFade.value).toBeCloseTo(0.02, 6);

    // Ramp to completion (dt clamps to 0.1/tick): old mesh dropped, survivor
    // reverts to the shared solid material (no uFade uniform).
    for (let i = 0; i < 12; i++) {
      clock.t += 0.1;
      mgr.update([{ x: 15, y: 0, z: 0 }]);
    }
    expect(mgr.group.children.length).toBe(1);
    const survivor = mgr.group.children[0] as THREE.Mesh;
    expect(survivor).toBe(newMesh);
    expect(survivor.geometry.attributes.position.count).toBeLessThan(nearVerts);
    expect((survivor.material as THREE.ShaderMaterial).uniforms.uFade).toBeUndefined();
    mgr.dispose();
  });

  it("low tier snaps (no cross-fade) even with crossFadeSeconds set", () => {
    const clock = { t: 0 };
    const { mgr } = xfadeMgr(clock, { quality: "low" });
    const mesh0 = mgr.group.children[0] as THREE.Mesh;
    clock.t = 0.02;
    mgr.update([{ x: 15, y: 0, z: 0 }]);
    // Instant swap: one mesh (same object), no fade material spawned.
    expect(mgr.group.children.length).toBe(1);
    expect(mgr.group.children[0]).toBe(mesh0);
    expect((mesh0.material as THREE.ShaderMaterial).uniforms.uFade).toBeUndefined();
    mgr.dispose();
  });

  it("disposing mid cross-fade clears both meshes + all bodies", () => {
    const clock = { t: 0 };
    const { physics, mgr } = xfadeMgr(clock);
    clock.t = 0.02;
    mgr.update([{ x: 15, y: 0, z: 0 }]);
    expect(mgr.group.children.length).toBe(2);
    mgr.dispose();
    expect(mgr.group.children.length).toBe(0);
    expect(bodyCount(physics)).toBe(0);
  });

  it("crossFadeSeconds unset -> instant swap (pre-198 behavior)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), TIER_CFG);
    const mesh0 = mgr.group.children[0] as THREE.Mesh;
    const before = mesh0.geometry.attributes.position.count;
    mgr.update([{ x: 15, y: 0, z: 0 }]);
    expect(mgr.group.children.length).toBe(1);
    expect(mesh0.geometry.attributes.position.count).toBeLessThan(before);
    mgr.dispose();
  });
});
