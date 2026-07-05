import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial } from "../materials/cel";
import type { SamplerTerrain } from "./propSampler";
import { Wildlife } from "./Wildlife";

/** Ring-of-radius-R stub: corridor distance = |hypot(x,z) - R|. */
function stubTerrain(
  overrides: Partial<{
    heightAt: (x: number, z: number) => number;
    normalY: (x: number, z: number) => number;
    ringR: number;
    spawn: THREE.Vector3;
  }> = {},
): SamplerTerrain {
  const ringR = overrides.ringR ?? 60;
  const spawn = overrides.spawn ?? new THREE.Vector3(62, 0, 0);
  const normalY = overrides.normalY ?? (() => 1);
  return {
    heightAt: overrides.heightAt ?? (() => 0),
    normalAt: (_x, _z, out = new THREE.Vector3()) => {
      const y = normalY(_x, _z);
      const x = Math.sqrt(Math.max(0, 1 - y * y));
      return out.set(x, y, 0);
    },
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

function matrixArray(w: Wildlife): Float32Array {
  const mesh = w.group.children[0] as THREE.InstancedMesh;
  return mesh.instanceMatrix.array as Float32Array;
}

describe("Wildlife", () => {
  it("is an InstancedMesh on layer 0 with a flat-shaded CelMaterial and no shadows", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 30, cell: 8 } });
    const mesh = w.group.children[0] as THREE.InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    expect(mesh.material).toBeInstanceOf(CelMaterial);
    expect((mesh.material as CelMaterial).flatShading).toBe(true);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    w.dispose();
  });

  it("instance count equals placed critters (<= count cap, > 0)", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 30, cell: 8 } });
    const mesh = w.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBeGreaterThan(0);
    expect(mesh.count).toBeLessThanOrEqual(30);
    w.dispose();
  });

  it("no outline child is added (instanced cel has no inverted-hull path)", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 30, cell: 8 } });
    expect(w.group.children.length).toBe(1);
    expect(w.group.children[0]).toBeInstanceOf(THREE.InstancedMesh);
    w.dispose();
  });

  it("same seed + same t -> identical matrices across instances (determinism)", () => {
    const terrain = stubTerrain();
    const opts = { seed: 42, critter: { count: 30, cell: 8 } };
    const a = new Wildlife(terrain, opts);
    const b = new Wildlife(terrain, opts);
    a.update(0, 3.5);
    b.update(0, 3.5);
    expect(Array.from(matrixArray(a))).toEqual(Array.from(matrixArray(b)));
    a.dispose();
    b.dispose();
  });

  it("update advances with time: matrices at t=0 differ from t=5", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 30, cell: 8 } });
    const at0 = Array.from(matrixArray(w));
    w.update(0, 5);
    const at5 = Array.from(matrixArray(w));
    expect(at5).not.toEqual(at0);
    w.dispose();
  });

  it("dispose frees geometry + material and is idempotent", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 30, cell: 8 } });
    expect(() => w.dispose()).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
    expect(w.group.children.length).toBe(0);
  });

  it("count 0 -> InstancedMesh of count 0, no throw", () => {
    const w = new Wildlife(stubTerrain(), { seed: 42, critter: { count: 0 } });
    const mesh = w.group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(0);
    expect(() => w.update(0, 1)).not.toThrow();
    expect(() => w.dispose()).not.toThrow();
  });
});
