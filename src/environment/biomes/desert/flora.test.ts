import { describe, expect, it } from "vitest";
import { makeRNG } from "../../../core/rng";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers the 8 desert kinds
import { buildCactus, buildSandRock, buildYucca, buildDryShrub, sandRockRadius } from "./flora";

/**
 * Desert flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 8 kinds register with the right
 * big/collider contract, the sandRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const DESERT_KINDS = [
  "cactus",
  "sandRock",
  "mesaRock",
  "desertSnag",
  "yucca",
  "dryShrub",
  "barrelCactus",
  "desertBloom",
] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("desert flora — registration", () => {
  it("all 8 desert kinds are registered", () => {
    for (const kind of DESERT_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("cactus/sandRock/mesaRock/desertSnag are big; the rest are decor", () => {
    expect(floraFor("cactus").big).toBe(true);
    expect(floraFor("sandRock").big).toBe(true);
    expect(floraFor("mesaRock").big).toBe(true);
    expect(floraFor("desertSnag").big).toBe(true);
    expect(floraFor("yucca").big).toBe(false);
    expect(floraFor("dryShrub").big).toBe(false);
    expect(floraFor("barrelCactus").big).toBe(false);
    expect(floraFor("desertBloom").big).toBe(false);
  });
});

describe("desert flora — collider contract", () => {
  it("cactus is a cylinder collider with halfHeight 2.8 + radius 0.55", () => {
    const collider = floraFor("cactus").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2.8);
      expect(collider.radius).toBe(0.55);
    }
  });

  it("desertSnag is a cylinder collider; mesaRock is a ball collider", () => {
    expect(floraFor("desertSnag").collider.shape).toBe("cylinder");
    expect(floraFor("mesaRock").collider.shape).toBe("ball");
  });

  it("sandRock is a ball collider whose radius fn matches sandRockRadius", () => {
    const collider = floraFor("sandRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(sandRockRadius(123));
    }
  });

  it("all decor kinds are collider:none", () => {
    for (const kind of ["yucca", "dryShrub", "barrelCactus", "desertBloom"]) {
      expect(floraFor(kind).collider.shape).toBe("none");
    }
  });
});

describe("desert flora — builders produce disposable geometry", () => {
  it("cactus builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildCactus(seed));
    }
  });

  it("sandRock builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildSandRock(seed));
    }
  });

  it("yucca + dryShrub build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildYucca());
    assertBuildsAndDisposes(buildDryShrub());
  });

  it("mesaRock + desertSnag build + dispose for a couple of seeds", () => {
    for (const seed of [1, 42]) {
      assertBuildsAndDisposes(floraFor("mesaRock").build(seed));
      assertBuildsAndDisposes(floraFor("desertSnag").build(seed));
    }
  });

  it("cactus height varies per seed (saguaro scatter, not clones)", () => {
    const maxY = (prop: BuiltProp): number => {
      const pos = prop.geometry.attributes.position;
      let m = -Infinity;
      for (let i = 0; i < pos.count; i++) m = Math.max(m, pos.getY(i));
      prop.dispose();
      return m;
    };
    const heights = [1, 2, 3, 4].map((s) => maxY(buildCactus(s)));
    expect(new Set(heights.map((h) => h.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe("desert flora — sandRock radius determinism", () => {
  it("sandRockRadius(s) is stable + equals its documented first RNG draw", () => {
    for (const seed of [0, 7, 12345]) {
      const r = sandRockRadius(seed);
      expect(r).toBe(sandRockRadius(seed));
      expect(r).toBe(makeRNG(seed).range(0.8, 1.5));
    }
  });
});
