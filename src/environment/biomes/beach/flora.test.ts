import { describe, expect, it } from "vitest";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers the 5 beach kinds
import { buildPalm, buildDriftwood, buildSeaRock, buildDuneGrass, buildShell } from "./flora";

/**
 * Beach flora registration + builder smoke tests. Mirrors
 * badlands/flora.test.ts: asserts the 5 kinds register with the right
 * big/collider contract and that each builder produces a disposable BuiltProp
 * with real geometry. palm + driftwood are bespoke big props; seaRock is a
 * flattened ballRock; duneGrass + shell are decor. All jsdom-safe (builders
 * use CelMaterial/BufferGeometry, no WebGL).
 */

const BEACH_KINDS = ["palm", "driftwood", "seaRock", "duneGrass", "shell"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("beach flora — registration", () => {
  it("all 5 beach kinds are registered", () => {
    for (const kind of BEACH_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("palm/driftwood/seaRock are big; duneGrass/shell are decor", () => {
    expect(floraFor("palm").big).toBe(true);
    expect(floraFor("driftwood").big).toBe(true);
    expect(floraFor("seaRock").big).toBe(true);
    expect(floraFor("duneGrass").big).toBe(false);
    expect(floraFor("shell").big).toBe(false);
  });
});

describe("beach flora — collider contract", () => {
  it("palm + driftwood are cylinder colliders; seaRock is a ball collider", () => {
    expect(floraFor("palm").collider.shape).toBe("cylinder");
    expect(floraFor("driftwood").collider.shape).toBe("cylinder");
    expect(floraFor("seaRock").collider.shape).toBe("ball");
  });

  it("palm collider spans the lower trunk (halfHeight 3.0, radius 0.55)", () => {
    const collider = floraFor("palm").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(3.0);
      expect(collider.radius).toBe(0.55);
    }
  });

  it("duneGrass + shell are collider:none", () => {
    for (const kind of ["duneGrass", "shell"]) {
      expect(floraFor(kind).collider.shape).toBe("none");
    }
  });
});

describe("beach flora — builders produce disposable geometry", () => {
  it("palm + driftwood + seaRock build + dispose for a few seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildPalm(seed));
      assertBuildsAndDisposes(buildDriftwood(seed));
      assertBuildsAndDisposes(buildSeaRock(seed));
    }
  });

  it("palms stay grounded (base at y ~= 0) and vary per seed", () => {
    // Trunk height + lean + crown scale are per-seed, so a grove should not be
    // identical clones. Assert varied crown heights while the root flare keeps
    // every palm grounded at y ~= 0.
    const heights = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const prop = buildPalm(seed);
      const g = prop.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(bb.min.y).toBeLessThan(0.05);
      heights.add(Math.round(bb.max.y * 10)); // crown height to 0.1 m
      prop.dispose();
    }
    expect(heights.size).toBeGreaterThanOrEqual(3);
  });

  it("driftwood rests on the sand (base at y ~= 0)", () => {
    for (const seed of [1, 42, 9999]) {
      const prop = buildDriftwood(seed);
      const g = prop.geometry;
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(g.boundingBox!.min.y).toBeLessThan(1e-3);
      prop.dispose();
    }
  });

  it("duneGrass + shell build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildDuneGrass());
    assertBuildsAndDisposes(buildShell());
  });
});

describe("beach flora — determinism", () => {
  it("same seed reproduces the same vertex count for the big kinds", () => {
    for (const seed of [3, 77, 40000]) {
      expect(buildPalm(seed).geometry.attributes.position.count).toBe(
        buildPalm(seed).geometry.attributes.position.count,
      );
      expect(buildDriftwood(seed).geometry.attributes.position.count).toBe(
        buildDriftwood(seed).geometry.attributes.position.count,
      );
      expect(buildSeaRock(seed).geometry.attributes.position.count).toBe(
        buildSeaRock(seed).geometry.attributes.position.count,
      );
    }
  });
});
