import { describe, expect, it } from "vitest";
import { chunkBounds, chunkCenter, chunkCoord, chunkKey, desiredChunks } from "./streamGrid";

const CS = 25;

describe("chunkKey", () => {
  it("origin -> '0,0'", () => {
    expect(chunkKey(0, 0)).toBe("0,0");
  });

  it("(1,-2) -> '1,-2'", () => {
    expect(chunkKey(1, -2)).toBe("1,-2");
  });

  it("matches the 'gx,gz' TerrainChunkManager key format", () => {
    expect(chunkKey(-7, 13)).toBe("-7,13");
    expect(chunkKey(0, 0)).toBe([0, 0].join(","));
  });
});

describe("chunkCoord", () => {
  it("origin -> (0,0)", () => {
    expect(chunkCoord(0, 0, CS)).toEqual({ gx: 0, gz: 0 });
  });

  it("(chunkSize, 0) -> (1,0)", () => {
    expect(chunkCoord(CS, 0, CS)).toEqual({ gx: 1, gz: 0 });
  });

  it("(-chunkSize, 0) -> (-1,0)", () => {
    expect(chunkCoord(-CS, 0, CS)).toEqual({ gx: -1, gz: 0 });
  });

  it("0.4*chunkSize -> 0 (below half)", () => {
    expect(chunkCoord(0.4 * CS, 0, CS).gx).toBe(0);
  });

  it("0.6*chunkSize -> 1 (round-half-up)", () => {
    expect(chunkCoord(0.6 * CS, 0, CS).gx).toBe(1);
  });

  it("negative half-rounds toward +Inf (-1.5*chunkSize -> -1)", () => {
    expect(chunkCoord(-1.5 * CS, 0, CS).gx).toBe(-1);
  });

  it("z axis mirrors x", () => {
    expect(chunkCoord(0, 0.6 * CS, CS).gz).toBe(1);
    expect(chunkCoord(0, -CS, CS).gz).toBe(-1);
  });
});

describe("chunkBounds", () => {
  it("(0,0) with cs=25 -> x0=-12.5, x1=12.5, z0=-12.5, z1=12.5", () => {
    expect(chunkBounds(0, 0, CS)).toEqual({ x0: -12.5, z0: -12.5, x1: 12.5, z1: 12.5 });
  });

  it("(1,0) -> x0=12.5, x1=37.5 (shifted by chunkSize)", () => {
    expect(chunkBounds(1, 0, CS)).toEqual({ x0: 12.5, z0: -12.5, x1: 37.5, z1: 12.5 });
  });

  it("seamless tiling: bounds(1,0).x0 === bounds(0,0).x1", () => {
    expect(chunkBounds(1, 0, CS).x0).toBe(chunkBounds(0, 0, CS).x1);
  });

  it("seamless tiling on z: bounds(0,1).z0 === bounds(0,0).z1", () => {
    expect(chunkBounds(0, 1, CS).z0).toBe(chunkBounds(0, 0, CS).z1);
  });

  it("negative chunk: bounds(-1,0).x1 === bounds(0,0).x0", () => {
    expect(chunkBounds(-1, 0, CS).x1).toBe(chunkBounds(0, 0, CS).x0);
  });
});

describe("chunkCenter", () => {
  it("(gx,gz,cs) -> (gx*cs, gz*cs)", () => {
    expect(chunkCenter(0, 0, CS)).toEqual({ x: 0, z: 0 });
    expect(chunkCenter(2, -3, CS)).toEqual({ x: 50, z: -75 });
    expect(chunkCenter(-1, 1, CS)).toEqual({ x: -25, z: 25 });
  });
});

describe("desiredChunks", () => {
  it("empty foci -> empty Set", () => {
    expect(desiredChunks([], 50, CS).size).toBe(0);
  });

  it("single focus at origin, radius=0 -> exactly the origin chunk", () => {
    expect(desiredChunks([{ x: 0, y: 0, z: 0 }], 0, CS)).toEqual(new Set(["0,0"]));
  });

  it("single focus at origin, radius=50 -> 3x3 + diagonal corners present", () => {
    const s = desiredChunks([{ x: 0, y: 0, z: 0 }], 50, CS);
    // center + axis neighbours (center-to-center 25 <= 50).
    expect(s.has("0,0")).toBe(true);
    expect(s.has("1,0")).toBe(true);
    expect(s.has("-1,0")).toBe(true);
    expect(s.has("0,1")).toBe(true);
    expect(s.has("0,-1")).toBe(true);
    // corners ~35.36 <= 50.
    expect(s.has("1,1")).toBe(true);
  });

  it("symmetric: if (a,b) present then (-a,-b) present for origin focus", () => {
    const s = desiredChunks([{ x: 0, y: 0, z: 0 }], 50, CS);
    for (const k of s) {
      const [a, b] = k.split(",").map(Number);
      expect(s.has(`${-a},${-b}`)).toBe(true);
    }
  });

  it("two foci far apart -> union contains both neighborhoods", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 100, y: 0, z: 100 };
    const union = desiredChunks([a, b], 30, CS);
    const justA = desiredChunks([a], 30, CS);
    const justB = desiredChunks([b], 30, CS);
    for (const k of justA) expect(union.has(k)).toBe(true);
    for (const k of justB) expect(union.has(k)).toBe(true);
  });

  it("focus at chunk (2,3) center with radius 0 -> includes '2,3'", () => {
    const f = { x: 2 * CS, y: 0, z: 3 * CS };
    expect(desiredChunks([f], 0, CS).has(chunkKey(2, 3))).toBe(true);
  });
});
