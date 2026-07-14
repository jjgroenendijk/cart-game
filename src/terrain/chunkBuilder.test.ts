import { describe, expect, it } from "vitest";
import {
  buildChunk,
  buildMorphTargets,
  buildSkirt,
  mergeGeometry,
  type ChunkGeometry,
  type ChunkRect,
} from "./chunkBuilder";
import { normalFromHeight, type HeightSource, type Rgb, type Vec3 } from "./heightSource";

const FLAT_H = 5;
const FLAT_RGB: Rgb = [0.1, 0.2, 0.3];
const UP: Vec3 = [0, 1, 0];

const flatSrc: HeightSource = {
  heightAt: (_x: number, _z: number) => FLAT_H,
  colorAt: (_x: number, _z: number, out: Rgb = [0, 0, 0]): Rgb => {
    out[0] = FLAT_RGB[0];
    out[1] = FLAT_RGB[1];
    out[2] = FLAT_RGB[2];
    return out;
  },
  normalAt: (_x: number, _z: number, out: Vec3 = [0, 0, 0]): Vec3 => {
    out[0] = UP[0];
    out[1] = UP[1];
    out[2] = UP[2];
    return out;
  },
};

const tiltedSrc: HeightSource = {
  heightAt: (x: number, z: number) => x + z,
  colorAt: (_x: number, _z: number, out: Rgb = [0, 0, 0]): Rgb => {
    out[0] = 0.4;
    out[1] = 0.5;
    out[2] = 0.6;
    return out;
  },
  normalAt: (x: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 =>
    normalFromHeight(x, z, (px, pz) => px + pz, out),
};

const RECT: ChunkRect = { x0: 0, z0: 0, x1: 8, z1: 4, segX: 4, segZ: 2 };

function vert(g: ChunkGeometry, i: number): [number, number, number] {
  return [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
}

describe("buildChunk — array sizes", () => {
  it("positions length = vertCount*3, colors = vertCount*3, indices = segX*segZ*6", () => {
    const g = buildChunk(RECT, flatSrc);
    const nX = RECT.segX + 1;
    const nZ = RECT.segZ + 1;
    const vertCount = nX * nZ;
    expect(g.positions.length).toBe(vertCount * 3);
    expect(g.colors.length).toBe(vertCount * 3);
    expect(g.indices.length).toBe(RECT.segX * RECT.segZ * 6);
  });

  it("outputs are typed arrays", () => {
    const g = buildChunk(RECT, flatSrc);
    expect(g.positions).toBeInstanceOf(Float32Array);
    expect(g.colors).toBeInstanceOf(Float32Array);
    expect(g.indices).toBeInstanceOf(Uint32Array);
  });
});

describe("buildChunk — vertex positions", () => {
  it("first vert at (x0, height, z0); last vert at (x1, height, z1)", () => {
    const g = buildChunk(RECT, flatSrc);
    expect(vert(g, 0)).toEqual([RECT.x0, FLAT_H, RECT.z0]);
    const last = (RECT.segX + 1) * (RECT.segZ + 1) - 1;
    expect(vert(g, last)).toEqual([RECT.x1, FLAT_H, RECT.z1]);
  });

  it("positions match src.heightAt at the 4 corners + center (flat plane)", () => {
    const g = buildChunk(RECT, flatSrc);
    const nX = RECT.segX + 1;
    const cx = RECT.x0 + (RECT.x1 - RECT.x0) / 2;
    const cz = RECT.z0 + (RECT.z1 - RECT.z0) / 2;
    const ix = Math.round((cx - RECT.x0) / ((RECT.x1 - RECT.x0) / RECT.segX));
    const iz = Math.round((cz - RECT.z0) / ((RECT.z1 - RECT.z0) / RECT.segZ));
    const centerIdx = iz * nX + ix;
    expect(g.positions[1]).toBeCloseTo(flatSrc.heightAt(RECT.x0, RECT.z0), 6);
    expect(g.positions[centerIdx * 3 + 1]).toBeCloseTo(flatSrc.heightAt(cx, cz), 6);
  });

  it("Y follows a tilted height source (h = x + z)", () => {
    const g = buildChunk(RECT, tiltedSrc);
    const nX = RECT.segX + 1;
    for (let iz = 0; iz <= RECT.segZ; iz++) {
      for (let ix = 0; ix <= RECT.segX; ix++) {
        const v = iz * nX + ix;
        const x = g.positions[v * 3];
        const y = g.positions[v * 3 + 1];
        const z = g.positions[v * 3 + 2];
        expect(y).toBeCloseTo(x + z, 6);
      }
    }
  });
});

describe("buildChunk — colors", () => {
  it("colors match src.colorAt (flat source -> every vert FLAT_RGB)", () => {
    const g = buildChunk(RECT, flatSrc);
    const vertCount = (RECT.segX + 1) * (RECT.segZ + 1);
    for (let v = 0; v < vertCount; v++) {
      expect(g.colors[v * 3]).toBeCloseTo(FLAT_RGB[0], 6);
      expect(g.colors[v * 3 + 1]).toBeCloseTo(FLAT_RGB[1], 6);
      expect(g.colors[v * 3 + 2]).toBeCloseTo(FLAT_RGB[2], 6);
    }
  });
});

describe("buildChunk — normals", () => {
  it("emits a normals array the same length as positions", () => {
    const g = buildChunk(RECT, flatSrc);
    expect(g.normals).toBeInstanceOf(Float32Array);
    expect(g.normals.length).toBe(g.positions.length);
  });

  it("flat source -> every normal is straight up (0,1,0)", () => {
    const g = buildChunk(RECT, flatSrc);
    const vertCount = (RECT.segX + 1) * (RECT.segZ + 1);
    for (let v = 0; v < vertCount; v++) {
      expect(g.normals[v * 3]).toBeCloseTo(0, 6);
      expect(g.normals[v * 3 + 1]).toBeCloseTo(1, 6);
      expect(g.normals[v * 3 + 2]).toBeCloseTo(0, 6);
    }
  });

  it("each normal equals src.normalAt at its (x,z)", () => {
    const g = buildChunk(RECT, tiltedSrc);
    const nX = RECT.segX + 1;
    const expected: Vec3 = [0, 0, 0];
    for (let iz = 0; iz <= RECT.segZ; iz++) {
      for (let ix = 0; ix <= RECT.segX; ix++) {
        const v = iz * nX + ix;
        const x = g.positions[v * 3];
        const z = g.positions[v * 3 + 2];
        tiltedSrc.normalAt(x, z, expected);
        expect(g.normals[v * 3]).toBeCloseTo(expected[0], 6);
        expect(g.normals[v * 3 + 1]).toBeCloseTo(expected[1], 6);
        expect(g.normals[v * 3 + 2]).toBeCloseTo(expected[2], 6);
      }
    }
  });

  it("world-consistent normals: adjacent chunks share identical border normals", () => {
    // Two side-by-side rects: B starts where A ends along X. Their shared
    // border verts sample the SAME world (x,z) lattice, so src.normalAt must
    // return the same value on both sides -> no seam step in the cel bands.
    const rectA: ChunkRect = { x0: 0, z0: 0, x1: 4, z1: 4, segX: 4, segZ: 4 };
    const rectB: ChunkRect = { x0: 4, z0: 0, x1: 8, z1: 4, segX: 4, segZ: 4 };
    const a = buildChunk(rectA, tiltedSrc);
    const b = buildChunk(rectB, tiltedSrc);
    const nA = rectA.segX + 1;
    const nB = rectB.segX + 1;
    // A's right column (ix = segX) vs B's left column (ix = 0).
    for (let iz = 0; iz <= rectA.segZ; iz++) {
      const va = iz * nA + rectA.segX;
      const vb = iz * nB + 0;
      expect(b.positions[vb * 3]).toBeCloseTo(a.positions[va * 3], 6); // x == x1
      expect(b.positions[vb * 3 + 2]).toBeCloseTo(a.positions[va * 3 + 2], 6); // z matches
      expect(b.normals[vb * 3]).toBeCloseTo(a.normals[va * 3], 6);
      expect(b.normals[vb * 3 + 1]).toBeCloseTo(a.normals[va * 3 + 1], 6);
      expect(b.normals[vb * 3 + 2]).toBeCloseTo(a.normals[va * 3 + 2], 6);
    }
  });
});

describe("buildChunk — index winding", () => {
  it("first cell = [0, nX, 1, 1, nX, nX+1] (a,c,b)+(b,c,d)", () => {
    const g = buildChunk(RECT, flatSrc);
    const nX = RECT.segX + 1;
    expect(Array.from(g.indices.slice(0, 6))).toEqual([0, nX, 1, 1, nX, nX + 1]);
  });

  it("all indices in range [0, vertCount)", () => {
    const g = buildChunk(RECT, flatSrc);
    const vertCount = (RECT.segX + 1) * (RECT.segZ + 1);
    for (let i = 0; i < g.indices.length; i++) {
      expect(g.indices[i]).toBeGreaterThanOrEqual(0);
      expect(g.indices[i]).toBeLessThan(vertCount);
    }
  });
});

describe("buildChunk — consumes an arbitrary HeightSource object literal", () => {
  it("flat literal {heightAt: ()=>7, colorAt: ()=>[1,0,0]} builds a chunk", () => {
    const fake: HeightSource = {
      heightAt: () => 7,
      colorAt: (): Rgb => [1, 0, 0],
      normalAt: (_x: number, _z: number, out: Vec3 = [0, 0, 0]): Vec3 => {
        out[0] = 0;
        out[1] = 1;
        out[2] = 0;
        return out;
      },
    };
    const g = buildChunk(RECT, fake);
    expect(g.positions[1]).toBe(7);
    expect(g.colors[0]).toBe(1);
    expect(g.colors[1]).toBe(0);
    expect(g.colors[2]).toBe(0);
  });
});

describe("buildSkirt — array sizes", () => {
  it("total verts = 2*((segZ+1)+(segZ+1)+(segX+1)+(segX+1)); indices = segZ*6*2 + segX*6*2", () => {
    const g = buildSkirt(RECT, flatSrc, 2);
    const totalVerts = 2 * (RECT.segZ + 1 + (RECT.segZ + 1) + (RECT.segX + 1) + (RECT.segX + 1));
    expect(g.positions.length).toBe(totalVerts * 3);
    expect(g.colors.length).toBe(totalVerts * 3);
    const totalIdx = RECT.segZ * 6 * 2 + RECT.segX * 6 * 2;
    expect(g.indices.length).toBe(totalIdx);
  });
});

function collectYByXZ(g: ChunkGeometry): Map<string, number[]> {
  const m = new Map<string, number[]>();
  const count = g.positions.length / 3;
  for (let i = 0; i < count; i++) {
    const x = g.positions[i * 3];
    const y = g.positions[i * 3 + 1];
    const z = g.positions[i * 3 + 2];
    const key = `${x},${z}`;
    const arr = m.get(key);
    if (arr) arr.push(y);
    else m.set(key, [y]);
  }
  return m;
}

describe("buildSkirt — flat plane", () => {
  it("top verts at terrain height (5), bottom verts exactly drop lower", () => {
    const drop = 2;
    const g = buildSkirt(RECT, flatSrc, drop);
    const byPos = collectYByXZ(g);
    for (const ys of byPos.values()) {
      expect(ys).toContain(FLAT_H);
      expect(ys).toContain(FLAT_H - drop);
    }
  });
});

describe("buildSkirt — tilted plane (h = x + z)", () => {
  it("top verts match edge heights at sampled +X edge points", () => {
    const drop = 3;
    const g = buildSkirt(RECT, tiltedSrc, drop);
    const byPos = collectYByXZ(g);
    const spanZ = RECT.z1 - RECT.z0;
    for (let i = 0; i <= RECT.segZ; i++) {
      const z = RECT.z0 + (spanZ * i) / RECT.segZ;
      const topY = RECT.x1 + z;
      const ys = byPos.get(`${RECT.x1},${z}`);
      expect(ys).toBeTruthy();
      expect(ys).toContain(topY);
      expect(ys).toContain(topY - drop);
    }
  });
});

describe("buildSkirt — non-zero area", () => {
  it("for drop > 0 every bottom vert is strictly below its top counterpart", () => {
    const drop = 2.5;
    const g = buildSkirt(RECT, tiltedSrc, drop);
    const byPos = collectYByXZ(g);
    expect(byPos.size).toBeGreaterThan(0);
    for (const ys of byPos.values()) {
      const top = Math.max(...ys);
      const bottom = Math.min(...ys);
      expect(top - bottom).toBeCloseTo(drop, 6);
      expect(bottom).toBeLessThan(top);
    }
  });

  it("drop = 0 collapses top and bottom to the same height (degenerate)", () => {
    const g = buildSkirt(RECT, flatSrc, 0);
    const byPos = collectYByXZ(g);
    for (const ys of byPos.values()) {
      expect(ys[0]).toBe(FLAT_H);
      expect(ys[1]).toBe(FLAT_H);
    }
  });
});

describe("buildChunk + buildSkirt run under jsdom without WebGL (pure path)", () => {
  it("both return ChunkGeometry typed arrays via the stub HeightSource", () => {
    const c = buildChunk(RECT, flatSrc);
    const s = buildSkirt(RECT, flatSrc, 1);
    expect(c.positions.length).toBeGreaterThan(0);
    expect(s.positions.length).toBeGreaterThan(0);
    expect(c.indices.length).toBeGreaterThan(0);
    expect(s.indices.length).toBeGreaterThan(0);
  });
});

describe("mergeGeometry — base + skirt into one buffer", () => {
  it("concatenates verts base-first and re-bases skirt indices past baseVerts", () => {
    const base = buildChunk(RECT, flatSrc);
    const skirt = buildSkirt(RECT, flatSrc, 2);
    const merged = mergeGeometry(base, skirt);
    const baseVerts = base.positions.length / 3;
    expect(merged.positions.length).toBe(base.positions.length + skirt.positions.length);
    expect(merged.colors.length).toBe(base.colors.length + skirt.colors.length);
    expect(merged.normals.length).toBe(base.normals.length + skirt.normals.length);
    expect(merged.indices.length).toBe(base.indices.length + skirt.indices.length);
    // Base verts sit first, unchanged; the first skirt vert follows.
    expect(merged.positions[0]).toBe(base.positions[0]);
    expect(merged.positions[base.positions.length]).toBe(skirt.positions[0]);
    // Skirt indices are shifted by baseVerts so they address the merged buffer.
    const firstSkirtIdx = merged.indices[base.indices.length];
    expect(firstSkirtIdx).toBe(skirt.indices[0]! + baseVerts);
  });
});

// h = x*x is nonlinear in x, so the coarse-grid bilinear differs from the fine
// vertex height at midpoints -> exercises the geomorph delta (not a trivial 0).
const parabSrc: HeightSource = {
  heightAt: (x: number) => x * x,
  colorAt: (_x, _z, out: Rgb = [0, 0, 0]): Rgb => out,
  normalAt: (_x, _z, out: Vec3 = [0, 0, 0]): Vec3 => {
    out[1] = 1;
    return out;
  },
};

describe("buildMorphTargets — LOD geomorph target heights", () => {
  const FINE: ChunkRect = { x0: 0, z0: 0, x1: 4, z1: 4, segX: 4, segZ: 4 };

  it("flat source -> every target equals the vertex's own y (delta 0, no morph)", () => {
    const g = buildChunk(FINE, flatSrc);
    const morph = buildMorphTargets(g.positions, FINE, 2, flatSrc);
    expect(morph.length).toBe(g.positions.length / 3);
    for (let v = 0; v < morph.length; v++) {
      expect(morph[v]).toBeCloseTo(g.positions[v * 3 + 1]!, 6);
    }
  });

  it("fine-only vertex morphs to the coarse bilinear; shared vertex stays put", () => {
    const g = buildChunk(FINE, parabSrc);
    // otherSeg=2 -> coarse grid lines at x = 0, 2, 4.
    const morph = buildMorphTargets(g.positions, FINE, 2, parabSrc);
    const nX = FINE.segX + 1;
    // x=1 (between coarse 0 and 2): coarse = lerp(0, 4, .5) = 2; fine h = 1.
    expect(g.positions[1 * 3 + 1]).toBeCloseTo(1, 6);
    expect(morph[1]).toBeCloseTo(2, 6);
    // x=3 (between coarse 2 and 4): coarse = lerp(4, 16, .5) = 10; fine h = 9.
    expect(morph[3]).toBeCloseTo(10, 6);
    // x=2 sits on a coarse grid line: target == its own height (no morph).
    expect(morph[2]).toBeCloseTo(g.positions[2 * 3 + 1]!, 6);
    // Whole rows repeat (parabola is z-independent) -> row iz=1 matches iz=0.
    expect(morph[nX + 1]).toBeCloseTo(2, 6);
  });

  it("adds the coarse delta to the CURRENT y so skirt-bottom drops are preserved", () => {
    // Synthetic skirt-bottom vert at (x=1, y=1-30) — delta at x=1 is (2-1)=1,
    // so the target keeps the 30 m drop: (1-30) + 1 = -28.
    const pos = new Float32Array([1, 1 - 30, 0]);
    const morph = buildMorphTargets(pos, FINE, 2, parabSrc);
    expect(morph[0]).toBeCloseTo(-28, 6);
  });
});
