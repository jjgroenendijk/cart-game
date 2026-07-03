import { describe, expect, it } from "vitest";
import { makeRNG } from "../../core/rng";
import type { BuiltProp } from "../propFactory";
import { ballRock, canopyTree, coniferTree, groundDecor, lumpyShrub } from "./archetypes";

/**
 * Archetype builder tests (backlog 055 commit 1): determinism, base-at-y=0,
 * collider/visual radius lockstep, FloraBuilder contract, vertex-budget caps
 * (big <= 600 tris, decor <= 60 tris — kartLod/bucket-merge budgets), and
 * clean dispose. All jsdom-safe (builders use BufferGeometry/CelMaterial, no
 * WebGL). Mirrors tundra.test.ts style.
 */

/** Vertex-budget caps derived from kartLod/bucket-merge per-instance budgets. */
const BIG_TRI_CAP = 600;
const DECOR_TRI_CAP = 60;

/** Position attribute as a plain array (for deep equality comparison). */
function positionTuple(prop: BuiltProp): number[] {
  return Array.from(prop.geometry.attributes.position.array);
}

/** Min Y across all vertices (base-at-y=0 discipline). */
function minY(prop: BuiltProp): number {
  const pos = prop.geometry.attributes.position;
  let m = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < m) m = y;
  }
  return m;
}

/** Triangle count of the built geometry (non-indexed after prepPart+merge). */
function triangles(prop: BuiltProp): number {
  const geo = prop.geometry;
  if (geo.index) return geo.index.count / 3;
  return geo.attributes.position.count / 3;
}

describe("archetype determinism", () => {
  it("same seed builds identical geometry (coniferTree)", () => {
    const b = coniferTree();
    expect(positionTuple(b.build(42))).toEqual(positionTuple(b.build(42)));
  });

  it("same seed builds identical geometry (ballRock)", () => {
    const b = ballRock();
    expect(positionTuple(b.build(7))).toEqual(positionTuple(b.build(7)));
  });

  it("different seeds produce different geometry (ballRock)", () => {
    const b = ballRock();
    expect(positionTuple(b.build(1))).not.toEqual(positionTuple(b.build(2)));
  });

  it("different seeds produce different geometry (canopyTree)", () => {
    const b = canopyTree();
    const a = positionTuple(b.build(10));
    const c = positionTuple(b.build(20));
    expect(a).not.toEqual(c);
  });
});

describe("base-at-y=0", () => {
  it("coniferTree sits at y=0", () => {
    expect(minY(coniferTree().build(42))).toBeLessThanOrEqual(0);
  });

  it("canopyTree sits at y=0", () => {
    expect(minY(canopyTree().build(42))).toBeLessThanOrEqual(0);
  });

  it("ballRock sinks below y=0 by ROCK_BURY", () => {
    expect(minY(ballRock().build(42))).toBeLessThan(0);
  });
});

describe("ballRock collider tracks visual radius", () => {
  it("collider.radius(seed) == makeRNG(seed).range(rMin, rMax)", () => {
    const b = ballRock({ rMin: 0.8, rMax: 1.6 });
    expect(b.collider.shape).toBe("ball");
    if (b.collider.shape === "ball") {
      for (const seed of [0, 1, 42, 9999]) {
        expect(b.collider.radius(seed)).toBe(makeRNG(seed).range(0.8, 1.6));
      }
    }
  });
});

describe("FloraBuilder contract", () => {
  it("coniferTree: big + cylinder", () => {
    const b = coniferTree();
    expect(b.big).toBe(true);
    expect(b.collider.shape).toBe("cylinder");
  });

  it("canopyTree: big + cylinder", () => {
    const b = canopyTree();
    expect(b.big).toBe(true);
    expect(b.collider.shape).toBe("cylinder");
  });

  it("ballRock: big + ball", () => {
    const b = ballRock();
    expect(b.big).toBe(true);
    expect(b.collider.shape).toBe("ball");
  });

  it("lumpyShrub: decor + none", () => {
    const b = lumpyShrub();
    expect(b.big).toBe(false);
    expect(b.collider.shape).toBe("none");
  });

  it("groundDecor: decor + none (both modes)", () => {
    expect(groundDecor({ mode: "blade" }).big).toBe(false);
    expect(groundDecor({ mode: "petal" }).big).toBe(false);
    expect(groundDecor().collider.shape).toBe("none");
  });
});

describe("vertex budget caps", () => {
  it("coniferTree default <= 600 tris", () => {
    expect(triangles(coniferTree().build(42))).toBeLessThanOrEqual(BIG_TRI_CAP);
  });

  it("canopyTree default <= 600 tris", () => {
    expect(triangles(canopyTree().build(42))).toBeLessThanOrEqual(BIG_TRI_CAP);
  });

  it("ballRock default <= 600 tris", () => {
    expect(triangles(ballRock().build(42))).toBeLessThanOrEqual(BIG_TRI_CAP);
  });

  it("lumpyShrub default <= 60 tris", () => {
    expect(triangles(lumpyShrub().build(0))).toBeLessThanOrEqual(DECOR_TRI_CAP);
  });

  it("groundDecor blade default <= 60 tris", () => {
    const t = triangles(groundDecor({ mode: "blade" }).build(0));
    expect(t).toBeLessThanOrEqual(DECOR_TRI_CAP);
  });

  it("groundDecor petal default <= 60 tris", () => {
    const t = triangles(groundDecor({ mode: "petal" }).build(0));
    expect(t).toBeLessThanOrEqual(DECOR_TRI_CAP);
  });
});

describe("dispose", () => {
  it("each archetype builds + disposes without throwing", () => {
    const builders = [
      coniferTree(),
      canopyTree(),
      ballRock(),
      lumpyShrub(),
      groundDecor({ mode: "blade" }),
      groundDecor({ mode: "petal" }),
    ];
    for (const b of builders) {
      for (const seed of [1, 42, 9999]) {
        const p = b.build(seed);
        expect(p.geometry.attributes.position.count).toBeGreaterThan(0);
        expect(() => p.dispose()).not.toThrow();
      }
    }
  });
});
