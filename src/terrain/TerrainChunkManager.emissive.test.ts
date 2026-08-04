import { describe, expect, it, beforeAll, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { TerrainChunkManager } from "./TerrainChunkManager";
import { EMISSIVE_LAYER } from "../materials/emissiveCapture";
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

/**
 * Small streaming config. worldSize 40, gridCount 2 -> chunkSize 20. Only
 * chunk (0,0) (bounds [-10,10]) is fully inside worldSize [-20,20] -> near; the
 * axis chunks reach +-30 -> far (no clone). streamRadius 25 seeds the plus-shape.
 */
const CFG = {
  worldSize: 40,
  gridCount: 2,
  streamRadius: 25,
  cullRadius: 35,
  maxActivations: 99,
} as const;

/** layer-3 mask: only EMISSIVE_LAYER enabled (main RenderPass must skip it). */
const EMISSIVE_MASK = 1 << EMISSIVE_LAYER;

/** Collect the layer-3 sibling clones parented under the manager group. */
function emissiveClones(mgr: TerrainChunkManager): THREE.Mesh[] {
  return mgr.group.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.layers.mask === EMISSIVE_MASK,
  );
}

/** The single near visible mesh (layer 1 + HEIGHT_MAP material). */
function nearMesh(mgr: TerrainChunkManager): THREE.Mesh | undefined {
  return mgr.group.children.find((c): c is THREE.Mesh => {
    if (!(c instanceof THREE.Mesh)) return false;
    const m = c.material as THREE.ShaderMaterial;
    return m.defines.HEIGHT_MAP === "" && c.layers.mask === 1 << 1;
  });
}

describe("TerrainChunkManager selective-bloom emissive clones (315)", () => {
  it("qualifying near chunk gets a layer-3-only sibling clone", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const clones = emissiveClones(mgr);
    // Exactly one near chunk (0,0) qualifies -> one clone.
    expect(clones.length).toBe(1);
    const clone = clones[0];
    // ONLY layer 3 enabled -> invisible to a main camera on layers 0/1/2.
    expect(clone.layers.isEnabled(EMISSIVE_LAYER)).toBe(true);
    expect(clone.layers.mask).toBe(EMISSIVE_MASK);
    expect(clone.layers.isEnabled(0)).toBe(false);
    expect(clone.layers.isEnabled(1)).toBe(false);
    expect(clone.layers.isEnabled(2)).toBe(false);
    // Emissive-output material + the glint path compiled in.
    const mat = clone.material as THREE.ShaderMaterial;
    expect(mat.defines.EMISSIVE_OUTPUT).toBe("");
    expect(mat.defines.SNOW_SPARKLE).toBe("");
    expect(mat.defines.HEIGHT_MAP).toBe("");
    // receiveShadow off + frozen matrix (matches visible mesh transform).
    expect(clone.receiveShadow).toBe(false);
    expect(clone.matrixAutoUpdate).toBe(false);
    const near = nearMesh(mgr)!;
    expect(clone.matrix.elements).toEqual(near.matrix.elements);
    mgr.dispose();
  });

  it("clone shares geometry by-ref with the visible mesh", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const near = nearMesh(mgr)!;
    const clone = emissiveClones(mgr)[0];
    expect(clone.geometry).toBe(near.geometry);
    mgr.dispose();
  });

  it("all near chunks share ONE materialNearEmissive instance", () => {
    const physics = new PhysicsWorld(-24);
    // gridCount 4 -> chunkSize 10; several chunks fully inside [-20,20].
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, gridCount: 4 });
    const clones = emissiveClones(mgr);
    expect(clones.length).toBeGreaterThan(1);
    const mats = new Set<THREE.Material>();
    for (const c of clones) mats.add(c.material as THREE.Material);
    expect(mats.size).toBe(1);
    // The shared material is distinct from the visible near material.
    const near = nearMesh(mgr)!;
    expect([...mats][0]).not.toBe(near.material);
    mgr.dispose();
  });

  it("runtime-written uniform refs are shared with the near material", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const near = nearMesh(mgr)!;
    const nearMat = near.material as THREE.ShaderMaterial;
    const emissiveMat = emissiveClones(mgr)[0].material as THREE.ShaderMaterial;
    // Module-singleton channels written once/frame by Renderer/Environment:
    // lightUniforms (sun/ambient/skyEnv), uWetness, uSnowCover, uSnowWindDir.
    expect(emissiveMat.uniforms.uSunDir).toBe(nearMat.uniforms.uSunDir);
    expect(emissiveMat.uniforms.uSunColor).toBe(nearMat.uniforms.uSunColor);
    expect(emissiveMat.uniforms.uAmbient).toBe(nearMat.uniforms.uAmbient);
    expect(emissiveMat.uniforms.uSkyEnv).toBe(nearMat.uniforms.uSkyEnv);
    expect(emissiveMat.uniforms.uWetness).toBe(nearMat.uniforms.uWetness);
    expect(emissiveMat.uniforms.uSnowCover).toBe(nearMat.uniforms.uSnowCover);
    expect(emissiveMat.uniforms.uSnowWindDir).toBe(nearMat.uniforms.uSnowWindDir);
    // A by-ref write on the shared singleton fans out to both materials.
    const before = (nearMat.uniforms.uSnowCover as { value: number }).value;
    (emissiveMat.uniforms.uSnowCover as { value: number }).value = 0.42;
    expect((nearMat.uniforms.uSnowCover as { value: number }).value).toBeCloseTo(0.42, 6);
    (nearMat.uniforms.uSnowCover as { value: number }).value = before; // reset shared ref
    mgr.dispose();
  });

  it("far chunks get NO clone (far material has no sparkle)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    // CFG seeds the plus-shape: 1 near (0,0) + 4 far axis chunks.
    expect(mgr.activeCount).toBeGreaterThan(1);
    expect(emissiveClones(mgr).length).toBe(1);
    mgr.dispose();
  });

  it("LOW tier: no clones at all (sparkle compiled out)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, quality: "low" });
    expect(emissiveClones(mgr).length).toBe(0);
    mgr.dispose();
  });

  it("deactivate removes the clone and does NOT double-dispose geometry", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const near = nearMesh(mgr)!;
    const clone = emissiveClones(mgr)[0];
    expect(clone.geometry).toBe(near.geometry); // shared ref
    const disposeSpy = vi.spyOn(near.geometry, "dispose");
    const before = mgr.activeCount;
    mgr.deactivate(0, 0);
    expect(mgr.activeCount).toBe(before - 1);
    // Clone gone from the group.
    expect(emissiveClones(mgr).length).toBe(0);
    expect(mgr.group.children.includes(clone)).toBe(false);
    // Geometry disposed EXACTLY once (shared between visible mesh + clone).
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
    mgr.dispose();
  });

  it("setQuality high -> low: clones removed + emissive material disposed", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const clone = emissiveClones(mgr)[0];
    const emissiveMat = clone.material as THREE.ShaderMaterial;
    const disposeSpy = vi.spyOn(emissiveMat, "dispose");
    mgr.setQuality("low");
    // Clones torn down.
    expect(emissiveClones(mgr).length).toBe(0);
    expect(mgr.group.children.includes(clone)).toBe(false);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
    mgr.dispose();
  });

  it("setQuality low -> high: clones appear on existing near chunks", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, quality: "low" });
    expect(emissiveClones(mgr).length).toBe(0);
    mgr.setQuality("high");
    const clones = emissiveClones(mgr);
    expect(clones.length).toBe(1);
    const mat = clones[0].material as THREE.ShaderMaterial;
    expect(mat.defines.EMISSIVE_OUTPUT).toBe("");
    expect(mat.defines.SNOW_SPARKLE).toBe("");
    // Geometry still shared with the visible mesh (clone back-filled, not rebuilt).
    expect(clones[0].geometry).toBe(nearMesh(mgr)!.geometry);
    mgr.dispose();
  });

  it("setQuality med <-> high rebuilds the emissive material + re-points clones", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), { ...CFG, quality: "med" });
    const matBefore = emissiveClones(mgr)[0].material as THREE.ShaderMaterial;
    mgr.setQuality("high");
    const cloneAfter = emissiveClones(mgr)[0];
    const matAfter = cloneAfter.material as THREE.ShaderMaterial;
    expect(matAfter).not.toBe(matBefore); // rebuilt instance
    expect(matAfter.defines.EMISSIVE_OUTPUT).toBe("");
    // Clone count unchanged (no add/remove on a non-low tier swap).
    expect(emissiveClones(mgr).length).toBe(1);
    mgr.dispose();
  });

  it("dispose tears down clones + the shared emissive material (no geometry leak)", () => {
    const physics = new PhysicsWorld(-24);
    const mgr = new TerrainChunkManager(physics, flatSrc(), CFG);
    const near = nearMesh(mgr)!;
    const clone = emissiveClones(mgr)[0];
    const geoSpy = vi.spyOn(near.geometry, "dispose");
    mgr.dispose();
    expect(geoSpy).toHaveBeenCalledTimes(1); // shared geometry freed once
    expect(mgr.group.children.includes(clone)).toBe(false);
    expect(mgr.group.children.length).toBe(0);
    geoSpy.mockRestore();
  });

  it("cross-fade survivor keeps the clone; outgoing geometry does not leak", () => {
    const clock = { t: 0 };
    const physics = new PhysicsWorld(-24);
    const TIER_CFG = {
      worldSize: 20,
      gridCount: 1,
      streamRadius: 4,
      cullRadius: 100,
      maxActivations: 99,
      lod: { near: 5, mid: 10, hysteresis: 2 },
      crossFadeSeconds: 1,
      now: () => clock.t,
    } as const;
    const mgr = new TerrainChunkManager(physics, flatSrc(), TIER_CFG);
    // Near chunk (0,0) inside [-10,10] worldSize 20 -> qualifies for a clone.
    expect(emissiveClones(mgr).length).toBe(1);
    const clone = emissiveClones(mgr)[0];
    // Drive a near->far tier swap with a tiny dt so the fade stays partial.
    clock.t = 0.02;
    mgr.update([{ x: 15, y: 0, z: 0 }]);
    // Clone persists (tied to state, not the transient fade meshes); its
    // geometry now references the survivor's new-tier geometry.
    expect(emissiveClones(mgr).length).toBe(1);
    expect(emissiveClones(mgr)[0]).toBe(clone);
    const survivor = mgr.group.children.find(
      (c): c is THREE.Mesh =>
        c instanceof THREE.Mesh && c.layers.mask === 1 << 1 && c !== mgr.group.children[0],
    )!;
    expect(clone.geometry).toBe(survivor.geometry);
    // Ramp to completion: outgoing mesh + its geometry disposed, clone intact.
    for (let i = 0; i < 12; i++) {
      clock.t += 0.1;
      mgr.update([{ x: 15, y: 0, z: 0 }]);
    }
    expect(emissiveClones(mgr).length).toBe(1);
    expect(emissiveClones(mgr)[0]).toBe(clone);
    mgr.dispose();
  });
});
