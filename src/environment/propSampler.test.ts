import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  type PlacedProp,
  type SamplerOptions,
  type SamplerTerrain,
  sampleProps,
} from "./propSampler";
import { degToRad } from "../core/math";

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
      // Build a unit normal whose .y == normalY (a genuine tilt, not a
      // collapsed axis vector). (sqrt(1-y^2), y, 0) is already length 1.
      const y = normalY(_x, _z);
      const x = Math.sqrt(Math.max(0, 1 - y * y));
      return out.set(x, y, 0);
    },
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    spline: {
      closestPoint: (x, z) => ({ dist: Math.abs(Math.hypot(x, z) - ringR) }),
    },
  };
}

function baseOpts(layers: SamplerOptions["layers"]): SamplerOptions {
  return {
    seed: 1337,
    worldHalfExtent: 100,
    edgeMargin: 4,
    cell: 3,
    maxAttemptsPerSlot: 4,
    trackHalfWidth: 6,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    layers,
  };
}

const treeLayer = { type: "tree" as const, count: 60, minScale: 1, maxScale: 1 };

const snapshot = (p: PlacedProp) => ({
  x: +p.x.toFixed(3),
  y: +p.y.toFixed(3),
  z: +p.z.toFixed(3),
  ny: +p.normal.y.toFixed(3),
  type: p.type,
  seed: p.seed,
  scale: +p.scale.toFixed(3),
});

describe("sampleProps — determinism", () => {
  it("same seed + terrain -> identical placement", () => {
    const t = stubTerrain();
    const a = sampleProps(t, baseOpts([treeLayer])).map(snapshot);
    const b = sampleProps(t, baseOpts([treeLayer])).map(snapshot);
    expect(a).toEqual(b);
  });

  it("different seed -> different placement", () => {
    const t = stubTerrain();
    const o1 = baseOpts([treeLayer]);
    const o2 = { ...baseOpts([treeLayer]), seed: 9999 };
    const a = sampleProps(t, o1).map(snapshot);
    const b = sampleProps(t, o2).map(snapshot);
    expect(a).not.toEqual(b);
  });

  it("per-layer sub-seed: tree placement is independent of a bush layer", () => {
    const t = stubTerrain();
    const treesOnly = sampleProps(t, baseOpts([treeLayer])).map(snapshot);
    const both = sampleProps(
      t,
      baseOpts([treeLayer, { type: "bush", count: 50, minScale: 1, maxScale: 1 }]),
    )
      .filter((p) => p.type === "tree")
      .map(snapshot);
    expect(treesOnly).toEqual(both);
  });
});

describe("sampleProps — rejection rules", () => {
  it("keeps the drivable corridor clear (dist >= trackHalfWidth + margin)", () => {
    const placed = sampleProps(stubTerrain(), baseOpts([treeLayer]));
    const min = 6 + 3;
    for (const p of placed) {
      const dist = Math.abs(Math.hypot(p.x, p.z) - 60);
      expect(dist).toBeGreaterThanOrEqual(min - 1e-6);
    }
  });

  it("keeps the spawn point clear", () => {
    const placed = sampleProps(stubTerrain(), baseOpts([treeLayer]));
    const spawn = new THREE.Vector3(62, 0, 0);
    for (const p of placed) {
      expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeGreaterThanOrEqual(12 - 1e-6);
    }
  });

  it("keeps props inside the world minus edgeMargin", () => {
    const placed = sampleProps(stubTerrain(), baseOpts([treeLayer]));
    const limit = 100 - 4;
    for (const p of placed) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(limit + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it("rejects ground steeper than maxSlope", () => {
    const steep = stubTerrain({
      normalY: () => 0.8,
    });
    const tilt = Math.acos(0.8);
    const opts = { ...baseOpts([treeLayer]), maxSlope: tilt - 0.001 };
    const placed = sampleProps(steep, opts);
    expect(placed).toHaveLength(0);
  });

  it("places on flat ground that steep layer rejected", () => {
    const flat = stubTerrain();
    const placed = sampleProps(flat, baseOpts([treeLayer]));
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(Math.acos(p.normal.y)).toBeLessThanOrEqual(degToRad(35) + 1e-6);
    }
  });

  it("respects per-layer slope override (decor on steep ground)", () => {
    const steep = stubTerrain({ normalY: () => 0.6 });
    const opts = baseOpts([
      { type: "grass", count: 40, minScale: 1, maxScale: 1, maxSlope: degToRad(90) },
    ]);
    const placed = sampleProps(steep, opts);
    expect(placed.length).toBeGreaterThan(0);
  });
});

describe("sampleProps — counts", () => {
  it("never exceeds the requested layer count", () => {
    const placed = sampleProps(stubTerrain(), baseOpts([treeLayer]));
    expect(placed.length).toBeLessThanOrEqual(treeLayer.count);
  });

  it("hits the requested count when area allows", () => {
    const placed = sampleProps(stubTerrain(), baseOpts([{ ...treeLayer, count: 20 }]));
    expect(placed.length).toBe(20);
  });

  it("tags each placement with type + a uint32 seed + in-range scale", () => {
    const placed = sampleProps(
      stubTerrain(),
      baseOpts([{ type: "rock", count: 15, minScale: 0.8, maxScale: 1.2 }]),
    );
    for (const p of placed) {
      expect(p.type).toBe("rock");
      expect(Number.isInteger(p.seed)).toBe(true);
      expect(p.seed).toBeGreaterThanOrEqual(0);
      expect(p.seed).toBeLessThanOrEqual(0xffffffff);
      expect(p.scale).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(p.scale).toBeLessThanOrEqual(1.2 + 1e-6);
    }
  });
});
