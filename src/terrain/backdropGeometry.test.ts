import { describe, expect, it } from "vitest";
import {
  backdropIndexCount,
  backdropVertexCount,
  buildBackdropRing,
  snapToStep,
  type BackdropRingParams,
} from "./backdropGeometry";
import { normalFromHeight, type HeightSource, type Rgb, type Vec3 } from "./heightSource";

const FLAT_H = 5;
const FLAT_RGB: Rgb = [0.1, 0.2, 0.3];

/** Flat source: constant height/color, up normal — lets us reason about radii. */
const flatSrc: HeightSource = {
  heightAt: () => FLAT_H,
  colorAt: (_x, _z, out: Rgb = [0, 0, 0]): Rgb => {
    out[0] = FLAT_RGB[0];
    out[1] = FLAT_RGB[1];
    out[2] = FLAT_RGB[2];
    return out;
  },
  normalAt: (_x, _z, out: Vec3 = [0, 0, 0]): Vec3 => {
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
    return out;
  },
};

/** Tilted source h = x + z so ridgelines track world (x,z), for alignment tests. */
const tiltedSrc: HeightSource = {
  heightAt: (x, z) => x + z,
  colorAt: (_x, _z, out: Rgb = [0, 0, 0]): Rgb => {
    out[0] = 0.4;
    out[1] = 0.5;
    out[2] = 0.6;
    return out;
  },
  normalAt: (x, z, out: Vec3 = [0, 0, 0]): Vec3 => normalFromHeight(x, z, (px, pz) => px + pz, out),
};

const PARAMS: BackdropRingParams = {
  centerX: 0,
  centerZ: 0,
  innerRadius: 100,
  outerRadius: 300,
  radialSegments: 4,
  angularSegments: 8,
  skirtDrop: 30,
};

function radius(g: { positions: Float32Array }, v: number, cx = 0, cz = 0): number {
  const x = g.positions[v * 3]!;
  const z = g.positions[v * 3 + 2]!;
  return Math.hypot(x - cx, z - cz);
}

describe("buildBackdropRing — array sizes", () => {
  it("vertex/index counts match the count helpers (base rings + skirt)", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const verts = backdropVertexCount(PARAMS.radialSegments, PARAMS.angularSegments, true);
    const idx = backdropIndexCount(PARAMS.radialSegments, PARAMS.angularSegments, true);
    expect(g.positions.length).toBe(verts * 3);
    expect(g.colors.length).toBe(verts * 3);
    expect(g.normals.length).toBe(verts * 3);
    expect(g.indices.length).toBe(idx);
  });

  it("count helpers: (rings+skirt)*A verts, (baseTris+skirtTris)*3 indices", () => {
    // rings = radialSegments + 1; skirt adds one bottom ring.
    expect(backdropVertexCount(4, 8, true)).toBe((5 + 1) * 8);
    expect(backdropVertexCount(4, 8, false)).toBe(5 * 8);
    expect(backdropIndexCount(4, 8, true)).toBe((4 * 8 * 2 + 8 * 2) * 3);
    expect(backdropIndexCount(4, 8, false)).toBe(4 * 8 * 2 * 3);
  });

  it("skirtDrop <= 0 emits no skirt (fewer verts + indices)", () => {
    const g = buildBackdropRing({ ...PARAMS, skirtDrop: 0 }, flatSrc);
    const verts = backdropVertexCount(PARAMS.radialSegments, PARAMS.angularSegments, false);
    expect(g.positions.length).toBe(verts * 3);
    expect(g.indices.length).toBe(
      backdropIndexCount(PARAMS.radialSegments, PARAMS.angularSegments, false),
    );
  });
});

describe("buildBackdropRing — annulus layout", () => {
  it("innermost ring sits at innerRadius (meets the streamed cull ring)", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const a = PARAMS.angularSegments;
    for (let ic = 0; ic < a; ic++) {
      expect(radius(g, ic)).toBeCloseTo(PARAMS.innerRadius, 4);
    }
  });

  it("outermost base ring sits at outerRadius", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const a = PARAMS.angularSegments;
    const outerBase = PARAMS.radialSegments * a;
    for (let ic = 0; ic < a; ic++) {
      expect(radius(g, outerBase + ic)).toBeCloseTo(PARAMS.outerRadius, 4);
    }
  });

  it("every base vertex is within [innerRadius, outerRadius] of the centre", () => {
    const g = buildBackdropRing({ ...PARAMS, centerX: 40, centerZ: -25 }, flatSrc);
    const baseVerts = (PARAMS.radialSegments + 1) * PARAMS.angularSegments;
    for (let v = 0; v < baseVerts; v++) {
      const r = radius(g, v, 40, -25);
      expect(r).toBeGreaterThanOrEqual(PARAMS.innerRadius - 1e-3);
      expect(r).toBeLessThanOrEqual(PARAMS.outerRadius + 1e-3);
    }
  });

  it("rings step linearly innerRadius -> outerRadius", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const a = PARAMS.angularSegments;
    const step = (PARAMS.outerRadius - PARAMS.innerRadius) / PARAMS.radialSegments;
    for (let ir = 0; ir <= PARAMS.radialSegments; ir++) {
      expect(radius(g, ir * a)).toBeCloseTo(PARAMS.innerRadius + ir * step, 3);
    }
  });
});

describe("buildBackdropRing — height sampling from the shared source", () => {
  it("base vertex y equals src.heightAt at its (x,z) so ridgelines align", () => {
    const g = buildBackdropRing({ ...PARAMS, centerX: 12, centerZ: -8 }, tiltedSrc);
    const baseVerts = (PARAMS.radialSegments + 1) * PARAMS.angularSegments;
    for (let v = 0; v < baseVerts; v++) {
      const x = g.positions[v * 3]!;
      const z = g.positions[v * 3 + 2]!;
      expect(g.positions[v * 3 + 1]!).toBeCloseTo(tiltedSrc.heightAt(x, z), 4);
    }
  });

  it("vertex colors come from src.colorAt", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    expect(g.colors[0]!).toBeCloseTo(FLAT_RGB[0], 5);
    expect(g.colors[1]!).toBeCloseTo(FLAT_RGB[1], 5);
    expect(g.colors[2]!).toBeCloseTo(FLAT_RGB[2], 5);
  });
});

describe("buildBackdropRing — outer skirt", () => {
  it("skirt bottom ring drops the outer edge by skirtDrop, sharing top color", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const a = PARAMS.angularSegments;
    const rings = PARAMS.radialSegments + 1;
    const topBase = (rings - 1) * a;
    const bottomBase = rings * a;
    for (let ic = 0; ic < a; ic++) {
      const t = topBase + ic;
      const b = bottomBase + ic;
      // Same XZ, dropped Y.
      expect(g.positions[b * 3]!).toBeCloseTo(g.positions[t * 3]!, 5);
      expect(g.positions[b * 3 + 2]!).toBeCloseTo(g.positions[t * 3 + 2]!, 5);
      expect(g.positions[b * 3 + 1]!).toBeCloseTo(g.positions[t * 3 + 1]! - PARAMS.skirtDrop, 5);
      // Inherits the top edge color.
      expect(g.colors[b * 3]!).toBe(g.colors[t * 3]!);
    }
  });
});

describe("buildBackdropRing — determinism + purity", () => {
  it("is deterministic for identical params (byte-identical arrays)", () => {
    const a = buildBackdropRing(PARAMS, tiltedSrc);
    const b = buildBackdropRing(PARAMS, tiltedSrc);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });

  it("recentring shifts vertices with the centre (world-space geometry)", () => {
    const a = buildBackdropRing(PARAMS, flatSrc);
    const b = buildBackdropRing({ ...PARAMS, centerX: 50 }, flatSrc);
    // First inner vertex moved +50 in X.
    expect(b.positions[0]! - a.positions[0]!).toBeCloseTo(50, 4);
  });

  it("all indices are in-range (no dangling references)", () => {
    const g = buildBackdropRing(PARAMS, flatSrc);
    const verts = g.positions.length / 3;
    for (const i of g.indices) expect(i).toBeLessThan(verts);
  });
});

describe("snapToStep", () => {
  it("snaps to the nearest multiple of step", () => {
    expect(snapToStep(70, 48)).toBe(48);
    expect(snapToStep(73, 48)).toBe(96);
    expect(snapToStep(-70, 48)).toBe(-48);
  });

  it("step <= 0 passes the value through unchanged", () => {
    expect(snapToStep(37, 0)).toBe(37);
  });
});
