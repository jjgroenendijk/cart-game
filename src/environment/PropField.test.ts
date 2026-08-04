import { describe, expect, it, beforeAll, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { PropField } from "./PropField";
import { sampleProps } from "./propSampler";
import { degToRad } from "../core/math";
import { EMISSIVE_LAYER } from "../materials/emissiveCapture";
import { impostorAtlasLayout } from "../materials/impostor";
import type { CelMaterial } from "../materials/cel";
import type { ImpostorAtlas } from "./ImpostorField";
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
      (c) =>
        !(c as THREE.InstancedMesh).isInstancedMesh &&
        (c as THREE.Mesh).isMesh &&
        (c as THREE.Mesh).layers.isEnabled(0),
    ) as THREE.Mesh[];
    // 2 big types * 4 default buckets = 8 upper bound; at least one since
    // bigProps > 0. Layer-3 emissive clones (315) are excluded by the layer-0
    // filter above.
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

  it("dispose frees merged big-prop meshes, idempotent", () => {
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
        (c) =>
          !(c as THREE.InstancedMesh).isInstancedMesh &&
          (c as THREE.Mesh).isMesh &&
          (c as THREE.Mesh).layers.isEnabled(0),
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
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
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
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
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
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
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

  // --- 315 selective bloom: layer-3 emissive clones for big-prop buckets ---

  /** Visible (layer-0) big-prop meshes, excluding layer-3 emissive clones. */
  function visibleBigMeshes(pf: PropField): THREE.Mesh[] {
    return pf.group.children.filter(
      (c) =>
        !(c as THREE.InstancedMesh).isInstancedMesh &&
        (c as THREE.Mesh).isMesh &&
        (c as THREE.Mesh).layers.isEnabled(0),
    ) as THREE.Mesh[];
  }

  it("big-prop buckets spawn one layer-3 emissive clone each (315)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    expect(visible.length).toBeGreaterThan(0);
    expect(pf.emissiveMeshes.length).toBe(visible.length);
    for (const m of pf.emissiveMeshes) {
      // Layer 3 ONLY (mask == 1 << EMISSIVE_LAYER, not OR'd with layer 0).
      expect(m.layers.mask).toBe(1 << EMISSIVE_LAYER);
      expect(m.castShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
      expect(m.matrixAutoUpdate).toBe(false);
    }
    pf.dispose();
  });

  it("emissive clone shares geometry with its visible mesh (same ref)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    expect(visible.length).toBe(pf.emissiveMeshes.length);
    for (let i = 0; i < visible.length; i++) {
      expect(pf.emissiveMeshes[i]!.geometry).toBe(visible[i]!.geometry);
    }
    pf.dispose();
  });

  it("emissive clone matches its visible mesh transform (matrix)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    for (let i = 0; i < visible.length; i++) {
      expect(pf.emissiveMeshes[i]!.matrix.equals(visible[i]!.matrix)).toBe(true);
    }
    pf.dispose();
  });

  it("uFade + uSnowCover uniforms are the SAME ref on visible + emissive mats", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    for (let i = 0; i < visible.length; i++) {
      const visMat = visible[i]!.material as CelMaterial;
      const emiMat = pf.emissiveMeshes[i]!.material as CelMaterial;
      // uFade is per-instance in CelMaterial -> wired by ref so setFade drives
      // both materials during the streaming dissolve.
      expect(emiMat.uniforms.uFade).toBe(visMat.uniforms.uFade);
      // uSnowCover is a module-level singleton (snowUniform) -> shared already.
      expect(emiMat.uniforms.uSnowCover).toBe(visMat.uniforms.uSnowCover);
    }
    pf.dispose();
  });

  it("visible big-prop material compiles SNOW_SPARKLE; emissive adds EMISSIVE_OUTPUT", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    for (let i = 0; i < visible.length; i++) {
      const visMat = visible[i]!.material as CelMaterial;
      const emiMat = pf.emissiveMeshes[i]!.material as CelMaterial;
      // Part 1: snowSparkle defaults on with snowCover:true -> glint compiled in.
      expect("SNOW_SPARKLE" in visMat.defines).toBe(true);
      expect("SNOW_SPARKLE" in emiMat.defines).toBe(true);
      // Emissive variant emits ONLY the glint; visible material unchanged.
      expect("EMISSIVE_OUTPUT" in emiMat.defines).toBe(true);
      expect("EMISSIVE_OUTPUT" in visMat.defines).toBe(false);
    }
    pf.dispose();
  });

  it("setFade drives the shared uFade into the emissive clones too", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    pf.setFade(0.4);
    for (const m of pf.emissiveMeshes) {
      expect((m.material as CelMaterial).uniforms.uFade.value).toBe(0.4);
    }
    pf.dispose();
  });

  it("dispose disposes emissive materials once; shared geometry disposed once total", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
    });
    const visible = visibleBigMeshes(pf);
    // Spy the SHARED geometry dispose (visible + clone point at the same geo)
    // and each emissive material dispose before tearing down.
    const geoSpies = visible.map((m) => vi.spyOn(m.geometry, "dispose"));
    const matSpies = pf.emissiveMeshes.map((m) => vi.spyOn(m.material as CelMaterial, "dispose"));

    pf.dispose();

    // Geometry disposed exactly once total (not once per clone).
    for (const s of geoSpies) expect(s).toHaveBeenCalledTimes(1);
    // Each emissive material disposed exactly once.
    for (const s of matSpies) expect(s).toHaveBeenCalledTimes(1);
    // Emissive clones removed from the group.
    expect(pf.group.children.length).toBe(0);
  });

  it("setImpostor hides/shows emissive clones in lockstep with big meshes", () => {
    const physics = new PhysicsWorld(-24);
    // Minimal stub atlas (no GL bake): ImpostorField builds from placements
    // whose kind resolves to a cell index >= 0.
    const atlas: ImpostorAtlas = {
      albedo: new THREE.Texture(),
      normal: new THREE.Texture(),
      layout: impostorAtlasLayout(2),
      cells: [
        { width: 1, height: 1 },
        { width: 1, height: 1 },
      ],
      cellForKind: (kind) => (kind === "tree" ? 0 : kind === "rock" ? 1 : -1),
      dispose() {},
    };
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
      impostorAtlas: atlas,
    });
    expect(pf.hasImpostors).toBe(true);
    expect(pf.emissiveMeshes.length).toBeGreaterThan(0);
    // Initially the 3D meshes (+ clones) are shown.
    expect(pf.emissiveMeshes.every((m) => m.visible)).toBe(true);

    pf.setImpostor(true);
    expect(pf.emissiveMeshes.every((m) => m.visible === false)).toBe(true);

    pf.setImpostor(false);
    expect(pf.emissiveMeshes.every((m) => m.visible === true)).toBe(true);
    pf.dispose();
  });

  it("emissiveClones:false skips clone creation (low-tier gate)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
      emissiveClones: false,
    });
    expect(pf.emissiveMeshes.length).toBe(0);
    // Visible big meshes still present.
    expect(visibleBigMeshes(pf).length).toBeGreaterThan(0);
    pf.dispose();
  });

  it("setEmissiveClones(false) tears down existing clones (high->low tier)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), { counts: smallCounts, cell: 6 });
    const n = pf.emissiveMeshes.length;
    expect(n).toBeGreaterThan(0);
    const matSpies = pf.emissiveMeshes.map((m) => vi.spyOn(m.material as CelMaterial, "dispose"));

    pf.setEmissiveClones(false);

    expect(pf.emissiveMeshes.length).toBe(0);
    for (const s of matSpies) expect(s).toHaveBeenCalledTimes(1);
    // Clones removed from the group; visible big meshes untouched.
    expect(visibleBigMeshes(pf).length).toBeGreaterThan(0);
    pf.dispose();
  });

  it("setEmissiveClones(true) rebuilds clones on existing buckets (low->high tier)", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), {
      counts: smallCounts,
      cell: 6,
      emissiveClones: false,
    });
    expect(pf.emissiveMeshes.length).toBe(0);
    const visible = visibleBigMeshes(pf);

    pf.setEmissiveClones(true);

    // One rebuilt clone per visible big bucket, on layer 3 only, sharing geo.
    expect(pf.emissiveMeshes.length).toBe(visible.length);
    for (let i = 0; i < visible.length; i++) {
      const clone = pf.emissiveMeshes[i]!;
      expect(clone.layers.mask).toBe(1 << EMISSIVE_LAYER);
      expect(clone.geometry).toBe(visible[i]!.geometry);
      expect("EMISSIVE_OUTPUT" in (clone.material as CelMaterial).defines).toBe(true);
    }
    pf.dispose();
  });

  it("setEmissiveClones is idempotent on an unchanged state", () => {
    const physics = new PhysicsWorld(-24);
    const pf = new PropField(physics, stubTerrain(), { counts: smallCounts, cell: 6 });
    const n = pf.emissiveMeshes.length;
    pf.setEmissiveClones(true); // already on
    expect(pf.emissiveMeshes.length).toBe(n);
    pf.setEmissiveClones(false);
    expect(pf.emissiveMeshes.length).toBe(0);
    pf.setEmissiveClones(false); // already off
    expect(pf.emissiveMeshes.length).toBe(0);
    pf.dispose();
  });
});
