import { describe, expect, it } from "vitest";
import {
  chunkLod,
  DEFAULT_TERRAIN_LOD,
  nearestChunkCameraDistance,
  segmentTier,
} from "./terrainLod";

describe("chunkLod — raw thresholds (prevTier undefined)", () => {
  it("distance 20 (< near 50) -> near", () => {
    expect(chunkLod(20)).toBe("near");
  });

  it("distance 80 (near 50..mid 110) -> mid", () => {
    expect(chunkLod(80)).toBe("mid");
  });

  it("distance 120 (> mid 110) -> far", () => {
    expect(chunkLod(120)).toBe("far");
  });

  it("exactly near (50) -> mid (strict <, not <=)", () => {
    expect(chunkLod(DEFAULT_TERRAIN_LOD.near)).toBe("mid");
  });

  it("exactly mid (110) -> far (strict <, not <=)", () => {
    expect(chunkLod(DEFAULT_TERRAIN_LOD.mid)).toBe("far");
  });
});

describe("chunkLod — hysteresis with prevTier (DEFAULT_TERRAIN_LOD)", () => {
  it("prev near: holds near below near+hys (distance 73 -> near)", () => {
    expect(chunkLod(73, "near")).toBe("near");
  });

  it("prev near: falls to mid past near+hys (distance 77 -> mid)", () => {
    expect(chunkLod(77, "near")).toBe("mid");
  });

  it("prev mid: holds mid above near-hys (distance 27 -> mid)", () => {
    expect(chunkLod(27, "mid")).toBe("mid");
  });

  it("prev mid: rises to near below near-hys (distance 23 -> near)", () => {
    expect(chunkLod(23, "mid")).toBe("near");
  });

  it("prev mid: holds mid below mid+hys (distance 133 -> mid)", () => {
    expect(chunkLod(133, "mid")).toBe("mid");
  });

  it("prev mid: falls to far past mid+hys (distance 137 -> far)", () => {
    expect(chunkLod(137, "mid")).toBe("far");
  });

  it("prev far: holds far above mid-hys (distance 87 -> far)", () => {
    expect(chunkLod(87, "far")).toBe("far");
  });

  it("prev far: drops to mid below mid-hys (distance 83 -> mid)", () => {
    expect(chunkLod(83, "far")).toBe("mid");
  });
});

describe("chunkLod — custom opts override near/mid/hysteresis", () => {
  it("custom near=20, mid=40 pin the raw bands", () => {
    const opts = { near: 20, mid: 40, hysteresis: 5 };
    expect(chunkLod(10, undefined, opts)).toBe("near");
    expect(chunkLod(30, undefined, opts)).toBe("mid");
    expect(chunkLod(50, undefined, opts)).toBe("far");
  });

  it("custom hys widens the near hold (prev near, near=20, hys=10)", () => {
    const opts = { near: 20, mid: 40, hysteresis: 10 };
    expect(chunkLod(26, "near", opts)).toBe("near");
    expect(chunkLod(32, "near", opts)).toBe("mid");
  });
});

describe("nearestChunkCameraDistance (pure)", () => {
  it("single cam returns its Euclidean distance (3-4-5 triangle)", () => {
    const d = nearestChunkCameraDistance({ x: 0, y: 0, z: 0 }, [{ x: 3, y: 4, z: 0 }]);
    expect(d).toBeCloseTo(5, 6);
  });

  it("two cams returns the min distance", () => {
    const d = nearestChunkCameraDistance({ x: 0, y: 0, z: 0 }, [
      { x: 10, y: 0, z: 0 },
      { x: 1, y: 2, z: 2 },
    ]);
    expect(d).toBeCloseTo(3, 6);
  });

  it("empty cams -> Infinity (chunk always treated as far)", () => {
    expect(nearestChunkCameraDistance({ x: 0, y: 0, z: 0 }, [])).toBe(Infinity);
  });
});

describe("segmentTier (quality x lod)", () => {
  it("high: near -> 25, mid -> 20, far -> 12", () => {
    expect(segmentTier("high", "near")).toBe(25);
    expect(segmentTier("high", "mid")).toBe(20);
    expect(segmentTier("high", "far")).toBe(12);
  });

  it("med: near -> 25, mid -> 20, far -> 12", () => {
    expect(segmentTier("med", "near")).toBe(25);
    expect(segmentTier("med", "mid")).toBe(20);
    expect(segmentTier("med", "far")).toBe(12);
  });

  it("low: near -> 12 (dropped), mid -> 20, far -> 12", () => {
    expect(segmentTier("low", "near")).toBe(12);
    expect(segmentTier("low", "mid")).toBe(20);
    expect(segmentTier("low", "far")).toBe(12);
  });
});
