import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { PropField } from "./PropField";
import { sampleProps } from "./propSampler";
import { degToRad } from "../core/math";
import type { SamplerTerrain } from "./propSampler";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

/**
 * Flat stub terrain satisfying SamplerTerrain. A ring of radius 60 gives an
 * off-track annulus so the sampler finds valid sites without a real mesh.
 */
function stubTerrain(): SamplerTerrain {
  const ringR = 60;
  const spawn = new THREE.Vector3(62, 0, 0);
  return {
    heightAt: () => 0,
    normalAt: (_x, _z, out = new THREE.Vector3()) => out.set(0, 1, 0),
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

/** Small counts so the suite is fast but exercises every code path. */
const smallCounts = { tree: 8, rock: 6, bush: 12, flower: 40, grass: 60 };

function bodyCount(physics: PhysicsWorld): number {
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

describe("PropField", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("big-prop body count == placed tree+rock count", () => {
    const physics = new PhysicsWorld(-24);
    const terrain = stubTerrain();
    const pf = new PropField(physics, terrain, {
      counts: smallCounts,
      cell: 6,
    });
    // Independent sampler run with the same opts to get the expected count.
    const layers = (["tree", "rock", "bush", "flower", "grass"] as const).map((kind) => ({
      kind,
      count: smallCounts[kind],
      minScale: 0.8,
      maxScale: 1.2,
      maxSlope: degToRad(35),
    }));
    const placed = sampleProps(terrain, {
      seed: 1337,
      worldHalfExtent: 100,
      edgeMargin: 4,
      cell: 6,
      maxAttemptsPerSlot: 4,
      corridorMargin: 3,
      spawnExclusionRadius: 12,
      maxSlope: degToRad(35),
      layers,
    });
    const big = placed.filter((p) => p.kind === "tree" || p.kind === "rock").length;
    expect(pf.stats.bigProps).toBe(big);
    // baseline 0 bodies -> after build equals big prop count
    expect(bodyCount(physics)).toBe(big);
    pf.dispose();
  });

  it("decor is InstancedMesh per type with >0 instances", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const instanced = pf.group.children.filter(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh[];
    expect(instanced.length).toBe(3); // bush + flower + grass
    for (const im of instanced) {
      expect(im.count).toBeGreaterThan(0);
      expect(im.instanceMatrix.count).toBe(im.count);
      expect(im.castShadow).toBe(false);
      // Tiny decor skips the per-frag shadow sample (perf 022 phase 4.3).
      expect(im.receiveShadow).toBe(false);
      expect(im.layers.isEnabled(0)).toBe(true);
      // Instance-aware boundingSphere computed at build so the renderer's
      // frustum-cull query has correct bounds from frame 0.
      expect(im.boundingSphere).not.toBeNull();
      expect(im.boundingSphere!.radius).toBeGreaterThan(0);
    }
    pf.dispose();
  });

  it("big props merge into spatial buckets (<= types*buckets)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const meshes = pf.group.children.filter(
      (c) => !(c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh[];
    // 2 big types * 4 default buckets = 8 upper bound; at least one since
    // bigProps > 0.
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes.length).toBeLessThanOrEqual(2 * 4);
    for (const m of meshes) {
      expect(m.castShadow).toBe(true);
      expect(m.layers.isEnabled(0)).toBe(true);
    }
    pf.dispose();
  });

  it("collider body count unchanged by merging", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    // Merging only collapses draw calls; every placed big prop keeps its body.
    expect(pf.stats.bigProps).toBeGreaterThan(0);
    expect(bodyCount(physics)).toBe(pf.stats.bigProps);
    pf.dispose();
  });

  it("colliders:false builds visuals without bodies; setColliders toggles them", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
      colliders: false,
    });
    // Visuals are present, but no Rapier bodies until setColliders(true).
    expect(pf.stats.bigProps).toBeGreaterThan(0);
    expect(pf.group.children.length).toBeGreaterThan(0);
    expect(bodyCount(physics)).toBe(0);
    expect(pf.hasColliders).toBe(false);

    pf.setColliders(true);
    expect(bodyCount(physics)).toBe(pf.stats.bigProps);
    expect(pf.hasColliders).toBe(true);
    // Idempotent: a second enable does not duplicate bodies.
    pf.setColliders(true);
    expect(bodyCount(physics)).toBe(pf.stats.bigProps);

    pf.setColliders(false);
    expect(bodyCount(physics)).toBe(0);
    expect(pf.hasColliders).toBe(false);
    pf.dispose();
  });

  it("dispose removes all Rapier bodies and clears the group", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    expect(pf.stats.bigProps).toBeGreaterThan(0);
    expect(bodyCount(physics)).toBe(pf.stats.bigProps);
    expect(pf.group.children.length).toBeGreaterThan(0);

    pf.dispose();
    expect(bodyCount(physics)).toBe(0);
    expect(pf.group.children.length).toBe(0);
  });

  it("dispose is idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    pf.dispose();
    expect(() => pf.dispose()).not.toThrow();
    expect(bodyCount(physics)).toBe(0);
  });

  it("dispose frees merged geo + outlines, idempotent", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const meshes = pf.group.children.filter(
      (c) => !(c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.Mesh).isMesh,
    ) as THREE.Mesh[];
    expect(meshes.length).toBeGreaterThan(0);

    pf.dispose();
    expect(() => pf.dispose()).not.toThrow();
    expect(bodyCount(physics)).toBe(0);
    expect(pf.group.children.length).toBe(0);
  });

  it("deterministic merged big-mesh count from identical opts + seed", () => {
    const opts = { counts: smallCounts, cell: 6, bigPropBuckets: 1 } as const;
    const a = new PropField(new PhysicsWorld(-24), stubTerrain(), opts);
    const b = new PropField(new PhysicsWorld(-24), stubTerrain(), opts);
    expect(a.stats.bigProps).toBe(b.stats.bigProps);
    expect(a.stats.bigProps).toBeGreaterThan(0);

    const bigMeshes = (pf: PropField) =>
      pf.group.children.filter(
        (c) => !(c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.Mesh).isMesh,
      ).length;
    // 1 bucket per type -> 1 merged mesh each (tree + rock both place >= 1).
    expect(bigMeshes(a)).toBe(2);
    expect(bigMeshes(a)).toBe(bigMeshes(b));

    a.dispose();
    b.dispose();
  });

  it("accepts pre-computed placements (skips sampling)", () => {
    const physics = new PhysicsWorld(-24);
    const terrain = stubTerrain();
    const placed = sampleProps(terrain, {
      seed: 999,
      worldHalfExtent: 100,
      edgeMargin: 4,
      cell: 6,
      maxAttemptsPerSlot: 4,
      corridorMargin: 3,
      spawnExclusionRadius: 12,
      maxSlope: degToRad(35),
      layers: (["tree", "rock", "bush", "flower", "grass"] as const).map((kind) => ({
        kind,
        count: smallCounts[kind],
        minScale: 0.8,
        maxScale: 1.2,
        maxSlope: degToRad(35),
      })),
    });
    const pf = new PropField(physics, terrain, {
      placements: placed,
      bigPropBuckets: 1,
    });
    const big = placed.filter((p) => p.kind === "tree" || p.kind === "rock").length;
    expect(pf.stats.bigProps).toBe(big);
    expect(bodyCount(physics)).toBe(big);
    pf.dispose();
  });

  it("setDensity thins decor draw count deterministically without touching bodies", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), { counts: smallCounts, cell: 6 });
    const decor = () =>
      pf.group.children.filter(
        (c) => (c as THREE.InstancedMesh).isInstancedMesh,
      ) as THREE.InstancedMesh[];
    const totals = decor().map((m) => m.instanceMatrix.count);
    const bodies = bodyCount(physics);
    expect(totals.every((t) => t > 0)).toBe(true);

    // Full density: every instance drawn.
    pf.setDensity(1);
    decor().forEach((m, i) => expect(m.count).toBe(totals[i]));

    // Half density: ~half the instances drawn, rounded, never above the total.
    pf.setDensity(0.5);
    decor().forEach((m, i) => {
      expect(m.count).toBe(Math.round(totals[i]! * 0.5));
      expect(m.count).toBeLessThan(totals[i]!);
    });

    // Zero density: nothing drawn, but instance buffer + bodies are intact.
    pf.setDensity(0);
    decor().forEach((m) => expect(m.count).toBe(0));
    decor().forEach((m, i) => expect(m.instanceMatrix.count).toBe(totals[i]));
    expect(bodyCount(physics)).toBe(bodies); // colliders never thinned

    // Clamps out-of-range and restores full at >=1.
    pf.setDensity(2);
    decor().forEach((m, i) => expect(m.count).toBe(totals[i]));
    pf.dispose();
  });

  it("decor draw subset is stable: instance identity persists across densities", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), { counts: smallCounts, cell: 6 });
    const im = pf.group.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh;
    const total = im.instanceMatrix.count;
    // Capture the first-`count` matrices at a low density, then a higher one:
    // the low-density subset must be a PREFIX of the higher (no reshuffle), so
    // an instance present at distance never flickers out as density thickens.
    pf.setDensity(0.3);
    const lowCount = im.count;
    const lowMats = Array.from({ length: lowCount }, (_, i) => {
      const m = new THREE.Matrix4();
      im.getMatrixAt(i, m);
      return m.elements.join(",");
    });
    pf.setDensity(0.7);
    expect(im.count).toBeGreaterThan(lowCount);
    for (let i = 0; i < lowCount; i++) {
      const m = new THREE.Matrix4();
      im.getMatrixAt(i, m);
      expect(m.elements.join(",")).toBe(lowMats[i]);
    }
    expect(lowCount).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(lowCount);
    pf.dispose();
  });

  it("setFade fans out to every big-bucket material (decor untouched)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), { counts: smallCounts, cell: 6 });
    const faded: number[] = [];
    let decorWithFade = 0;
    pf.setFade(0.25);
    pf.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.ShaderMaterial | undefined;
      const u = mat?.uniforms?.uFade;
      if (!u) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) decorWithFade++;
      else faded.push(u.value as number);
    });
    // Big buckets carry the driven value.
    expect(faded.length).toBeGreaterThan(0);
    expect(faded.every((v) => v === 0.25)).toBe(true);
    // Decor (InstancedMesh) stays plain: subpixel at the stream edge.
    expect(decorWithFade).toBe(0);
    pf.dispose();
  });
});
