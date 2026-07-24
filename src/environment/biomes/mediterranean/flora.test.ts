import { describe, expect, it } from "vitest";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers the 5 mediterranean kinds
import { buildCypress, buildPoplar, buildOliveRock, buildVineRow, buildLavender } from "./flora";

/**
 * Mediterranean flora registration + builder smoke tests. Mirrors
 * beach/flora.test.ts: asserts the 5 kinds register with the right
 * big/collider contract and that each builder produces a disposable BuiltProp
 * with real geometry. cypress/poplar/oliveRock are archetype big props;
 * vineRow is the one bespoke build (a trellis row segment) and lavender a
 * groundDecor tuft. All jsdom-safe (no WebGL).
 */

const MEDITERRANEAN_KINDS = ["cypress", "poplar", "oliveRock", "vineRow", "lavender"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("mediterranean flora — registration", () => {
  it("all 5 mediterranean kinds are registered", () => {
    for (const kind of MEDITERRANEAN_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("cypress/poplar/oliveRock are big; vineRow/lavender are decor", () => {
    expect(floraFor("cypress").big).toBe(true);
    expect(floraFor("poplar").big).toBe(true);
    expect(floraFor("oliveRock").big).toBe(true);
    expect(floraFor("vineRow").big).toBe(false);
    expect(floraFor("lavender").big).toBe(false);
  });

  it("cypress grows in short avenues (cluster recipe)", () => {
    expect(floraFor("cypress").cluster).toEqual({ radius: 5, perCluster: 3 });
  });
});

describe("mediterranean flora — collider contract", () => {
  it("cypress + poplar are cylinder colliders; oliveRock is a ball collider", () => {
    expect(floraFor("cypress").collider.shape).toBe("cylinder");
    expect(floraFor("poplar").collider.shape).toBe("cylinder");
    expect(floraFor("oliveRock").collider.shape).toBe("ball");
  });

  it("oliveRock collider radius tracks the visible bulk per seed", () => {
    const collider = floraFor("oliveRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      for (const seed of [1, 42, 9999]) {
        const r = collider.radius(seed);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(1.9);
      }
    }
  });

  it("vineRow + lavender are collider:none", () => {
    for (const kind of ["vineRow", "lavender"]) {
      expect(floraFor(kind).collider.shape).toBe("none");
    }
  });
});

describe("mediterranean flora — builders produce disposable geometry", () => {
  it("cypress + poplar + oliveRock build + dispose for a few seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildCypress(seed));
      assertBuildsAndDisposes(buildPoplar(seed));
      assertBuildsAndDisposes(buildOliveRock(seed));
    }
  });

  it("cypress + poplar stay grounded and read as tall narrow silhouettes", () => {
    // Slim crowns are the identity of both kinds: assert the silhouette stays
    // far taller than it is wide, and that the trunk base sits on the ground.
    for (const build of [buildCypress, buildPoplar]) {
      for (const seed of [1, 42, 9999]) {
        const prop = build(seed);
        const g = prop.geometry;
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6);
        expect(bb.min.y).toBeLessThan(0.05);
        const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        expect(bb.max.y).toBeGreaterThan(width * 2);
        prop.dispose();
      }
    }
  });

  it("cypress height varies per seed (an avenue, not clones)", () => {
    const heights = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const prop = buildCypress(seed);
      prop.geometry.computeBoundingBox();
      heights.add(Math.round(prop.geometry.boundingBox!.max.y * 10)); // to 0.1 m
      prop.dispose();
    }
    expect(heights.size).toBeGreaterThanOrEqual(3);
  });

  it("vineRow + lavender build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildVineRow());
    assertBuildsAndDisposes(buildLavender());
  });

  it("vineRow reads as a row: grounded, wider along X than across Z", () => {
    const prop = buildVineRow();
    const g = prop.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bb.max.x - bb.min.x).toBeGreaterThan((bb.max.z - bb.min.z) * 2);
    prop.dispose();
  });

  it("vineRow stays inside the <= 60-tri decor budget", () => {
    const prop = buildVineRow();
    const g = prop.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    expect(tris).toBeLessThanOrEqual(60);
    prop.dispose();
  });
});

describe("mediterranean flora — determinism", () => {
  it("same seed reproduces the same vertex count for the big kinds", () => {
    for (const seed of [3, 77, 40000]) {
      expect(buildCypress(seed).geometry.attributes.position.count).toBe(
        buildCypress(seed).geometry.attributes.position.count,
      );
      expect(buildPoplar(seed).geometry.attributes.position.count).toBe(
        buildPoplar(seed).geometry.attributes.position.count,
      );
      expect(buildOliveRock(seed).geometry.attributes.position.count).toBe(
        buildOliveRock(seed).geometry.attributes.position.count,
      );
    }
  });
});
