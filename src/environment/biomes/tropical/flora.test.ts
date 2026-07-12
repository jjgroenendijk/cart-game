import { describe, expect, it } from "vitest";
import { makeRNG } from "../../../core/rng";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers palm/jungleRock/fernShrub/tropicalFlower
import {
  buildPalm,
  buildJungleRock,
  buildFernShrub,
  buildTropicalFlower,
  buildSeaOats,
  buildHibiscus,
  jungleRockRadius,
} from "./flora";

/**
 * Tropical flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 6 kinds register with the right
 * big/collider contract, the jungleRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const TROPICAL_KINDS = [
  "palm",
  "kapok",
  "jungleRock",
  "fernShrub",
  "broadleaf",
  "tropicalFlower",
  "seaOats",
  "hibiscus",
] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("tropical flora — registration", () => {
  it("all 8 tropical kinds are registered", () => {
    for (const kind of TROPICAL_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("palm/kapok/jungleRock are big; the rest are decor", () => {
    expect(floraFor("palm").big).toBe(true);
    expect(floraFor("kapok").big).toBe(true);
    expect(floraFor("jungleRock").big).toBe(true);
    expect(floraFor("fernShrub").big).toBe(false);
    expect(floraFor("broadleaf").big).toBe(false);
    expect(floraFor("tropicalFlower").big).toBe(false);
    expect(floraFor("seaOats").big).toBe(false);
    expect(floraFor("hibiscus").big).toBe(false);
  });

  it("kapok builds + disposes and is a cylinder collider", () => {
    expect(floraFor("kapok").collider.shape).toBe("cylinder");
    for (const seed of [1, 42]) {
      assertBuildsAndDisposes(floraFor("kapok").build(seed));
    }
  });
});

describe("tropical flora — collider contract", () => {
  it("palm is a cylinder collider with halfHeight 3.0 + radius 0.55", () => {
    const collider = floraFor("palm").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(3.0);
      expect(collider.radius).toBe(0.55);
    }
  });

  it("jungleRock is a ball collider whose radius fn matches jungleRockRadius", () => {
    const collider = floraFor("jungleRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(jungleRockRadius(123));
    }
  });

  it("fernShrub/tropicalFlower/seaOats/hibiscus are collider:none", () => {
    expect(floraFor("fernShrub").collider.shape).toBe("none");
    expect(floraFor("tropicalFlower").collider.shape).toBe("none");
    expect(floraFor("seaOats").collider.shape).toBe("none");
    expect(floraFor("hibiscus").collider.shape).toBe("none");
  });
});

describe("tropical flora — builders produce disposable geometry", () => {
  it("palm builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildPalm(seed));
    }
  });

  it("jungleRock builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildJungleRock(seed));
    }
  });

  it("palm crown scales with seed (more geometry than the old 2-3 cone build)", () => {
    // The reworked palm fans 6-9 fronds + coconuts; assert it carries more
    // verts than a bare 4-seg cone so a regression to the sparse crown trips.
    const verts = buildPalm(42).geometry.attributes.position.count;
    expect(verts).toBeGreaterThan(200);
  });

  it("palms vary per seed (height + silhouette differ; base stays grounded)", () => {
    // Trunk height + lean + crown scale are per-seed, so a grove should not
    // be identical clones. Assert varied crown heights across seeds while the
    // root flare keeps every palm grounded at y ~= 0.
    const heights = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const prop = buildPalm(seed);
      const g = prop.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      expect(bb).toBeDefined();
      expect(bb!.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(bb!.min.y).toBeLessThan(0.05);
      heights.add(Math.round(bb!.max.y * 10)); // crown height to 0.1 m
      prop.dispose();
    }
    expect(heights.size).toBeGreaterThanOrEqual(3);
  });

  it("fernShrub/tropicalFlower/seaOats/hibiscus build + dispose (shared template)", () => {
    assertBuildsAndDisposes(buildFernShrub());
    assertBuildsAndDisposes(buildTropicalFlower());
    assertBuildsAndDisposes(buildSeaOats());
    assertBuildsAndDisposes(buildHibiscus());
  });
});

describe("tropical flora — jungleRock radius determinism", () => {
  it("jungleRockRadius(s) is stable + equals its documented first RNG draw", () => {
    for (const seed of [0, 7, 12345]) {
      const r = jungleRockRadius(seed);
      expect(r).toBe(jungleRockRadius(seed));
      expect(r).toBe(makeRNG(seed).range(0.9, 1.8));
    }
  });
});
