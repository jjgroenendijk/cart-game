import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  type ChunkSampleOptions,
  type PlacedProp,
  type SamplerOptions,
  type SamplerTerrain,
  sampleChunkProps,
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
    corridorClearance: (x, z) => Math.abs(Math.hypot(x, z) - ringR) - 6,
  };
}

function baseOpts(layers: SamplerOptions["layers"]): SamplerOptions {
  return {
    seed: 1337,
    worldHalfExtent: 100,
    edgeMargin: 4,
    cell: 3,
    maxAttemptsPerSlot: 4,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    layers,
  };
}

const treeLayer = { kind: "tree" as const, count: 60, minScale: 1, maxScale: 1 };

const snapshot = (p: PlacedProp) => ({
  x: +p.x.toFixed(3),
  y: +p.y.toFixed(3),
  z: +p.z.toFixed(3),
  ny: +p.normal.y.toFixed(3),
  kind: p.kind,
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
      baseOpts([treeLayer, { kind: "bush", count: 50, minScale: 1, maxScale: 1 }]),
    )
      .filter((p) => p.kind === "tree")
      .map(snapshot);
    expect(treesOnly).toEqual(both);
  });
});

describe("sampleProps — rejection rules", () => {
  it("keeps the drivable corridor clear (clearance >= margin)", () => {
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
      { kind: "grass", count: 40, minScale: 1, maxScale: 1, maxSlope: degToRad(90) },
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

  it("tags each placement with kind + a uint32 seed + in-range scale", () => {
    const placed = sampleProps(
      stubTerrain(),
      baseOpts([{ kind: "rock", count: 15, minScale: 0.8, maxScale: 1.2 }]),
    );
    for (const p of placed) {
      expect(p.kind).toBe("rock");
      expect(Number.isInteger(p.seed)).toBe(true);
      expect(p.seed).toBeGreaterThanOrEqual(0);
      expect(p.seed).toBeLessThanOrEqual(0xffffffff);
      expect(p.scale).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(p.scale).toBeLessThanOrEqual(1.2 + 1e-6);
    }
  });
});

function chunkOpts(overrides: Partial<ChunkSampleOptions> = {}): ChunkSampleOptions {
  return {
    cell: 3,
    maxAttemptsPerCell: 4,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    ...overrides,
  };
}

const chunkRect = { x0: 50, z0: 50, x1: 75, z1: 75 };

describe("sampleChunkProps — determinism", () => {
  it("same (gx,gz) + baseSeed + terrain -> identical placement", () => {
    const t = stubTerrain();
    const a = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts()).map(snapshot);
    const b = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts()).map(snapshot);
    expect(a).toEqual(b);
  });

  it("different chunk coord -> different placement", () => {
    const t = stubTerrain();
    const a = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts()).map(snapshot);
    const b = sampleChunkProps(2, 4, chunkRect, t, 1337, [treeLayer], chunkOpts()).map(snapshot);
    expect(a).not.toEqual(b);
  });

  it("different baseSeed -> different placement", () => {
    const t = stubTerrain();
    const a = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts()).map(snapshot);
    const b = sampleChunkProps(2, 3, chunkRect, t, 9999, [treeLayer], chunkOpts()).map(snapshot);
    expect(a).not.toEqual(b);
  });

  it("per-layer sub-seed: tree placement is independent of a bush layer", () => {
    const t = stubTerrain();
    const treesOnly = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts())
      .filter((p) => p.kind === "tree")
      .map(snapshot);
    const both = sampleChunkProps(
      2,
      3,
      chunkRect,
      t,
      1337,
      [treeLayer, { kind: "bush", count: 50, minScale: 1, maxScale: 1 }],
      chunkOpts(),
    )
      .filter((p) => p.kind === "tree")
      .map(snapshot);
    expect(treesOnly).toEqual(both);
  });
});

describe("sampleChunkProps — rejection + bounds", () => {
  it("keeps every placement within the chunk rect (+/- jitter)", () => {
    const t = stubTerrain();
    const placed = sampleChunkProps(2, 3, chunkRect, t, 1337, [treeLayer], chunkOpts());
    const half = 3 / 2;
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(chunkRect.x0 - half - 1e-6);
      expect(p.x).toBeLessThanOrEqual(chunkRect.x1 + half + 1e-6);
      expect(p.z).toBeGreaterThanOrEqual(chunkRect.z0 - half - 1e-6);
      expect(p.z).toBeLessThanOrEqual(chunkRect.z1 + half + 1e-6);
    }
  });

  it("keeps the drivable corridor clear (near-ring chunk)", () => {
    const t = stubTerrain();
    const rect = { x0: 50, z0: -12, x1: 75, z1: 12 };
    const placed = sampleChunkProps(2, 3, rect, t, 1337, [treeLayer], chunkOpts());
    const min = 6 + 3;
    for (const p of placed) {
      const dist = Math.abs(Math.hypot(p.x, p.z) - 60);
      expect(dist).toBeGreaterThanOrEqual(min - 1e-6);
    }
  });

  it("rejects ground steeper than maxSlope", () => {
    const steep = stubTerrain({ normalY: () => 0.8 });
    const tilt = Math.acos(0.8);
    const opts = { ...chunkOpts(), maxSlope: tilt - 0.001 };
    const placed = sampleChunkProps(2, 3, chunkRect, steep, 1337, [treeLayer], opts);
    expect(placed).toHaveLength(0);
  });

  it("dresses a far-from-track chunk (corridor is a no-op far out)", () => {
    const t = stubTerrain();
    const rect = { x0: 200, z0: 200, x1: 225, z1: 225 };
    const placed = sampleChunkProps(
      2,
      3,
      rect,
      t,
      1337,
      [{ ...treeLayer, count: 10 }],
      chunkOpts(),
    );
    expect(placed.length).toBeGreaterThan(0);
  });
});

describe("sampleChunkProps — counts", () => {
  it("never exceeds the requested layer count", () => {
    const t = stubTerrain();
    const placed = sampleChunkProps(
      2,
      3,
      chunkRect,
      t,
      1337,
      [{ ...treeLayer, count: 5 }],
      chunkOpts(),
    );
    expect(placed.length).toBeLessThanOrEqual(5);
  });

  it("hits the requested count when the area allows", () => {
    const t = stubTerrain();
    const rect = { x0: 200, z0: 200, x1: 225, z1: 225 };
    const placed = sampleChunkProps(2, 3, rect, t, 1337, [{ ...treeLayer, count: 3 }], chunkOpts());
    expect(placed.length).toBe(3);
  });
});
