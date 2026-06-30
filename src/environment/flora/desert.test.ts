import { describe, expect, it } from "vitest";
import { makeRNG } from "../../core/rng";
import type { BuiltProp } from "../propFactory";
import { floraFor, isRegisteredFlora } from "../floraRegistry";
import "./desert"; // side-effect: registers cactus/sandRock/yucca/dryShrub
import { buildCactus, buildSandRock, buildYucca, buildDryShrub, sandRockRadius } from "./desert";

/**
 * Desert flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 4 kinds register with the right
 * big/collider contract, the sandRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const DESERT_KINDS = ["cactus", "sandRock", "yucca", "dryShrub"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("desert flora — registration", () => {
  it("cactus/sandRock/yucca/dryShrub are all registered", () => {
    for (const kind of DESERT_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("cactus + sandRock are big; yucca + dryShrub are decor", () => {
    expect(floraFor("cactus").big).toBe(true);
    expect(floraFor("sandRock").big).toBe(true);
    expect(floraFor("yucca").big).toBe(false);
    expect(floraFor("dryShrub").big).toBe(false);
  });
});

describe("desert flora — collider contract", () => {
  it("cactus is a cylinder collider with halfHeight 2.0 + radius 0.5", () => {
    const collider = floraFor("cactus").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2.0);
      expect(collider.radius).toBe(0.5);
    }
  });

  it("sandRock is a ball collider whose radius fn matches sandRockRadius", () => {
    const collider = floraFor("sandRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(sandRockRadius(123));
    }
  });

  it("yucca + dryShrub are collider:none", () => {
    expect(floraFor("yucca").collider.shape).toBe("none");
    expect(floraFor("dryShrub").collider.shape).toBe("none");
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
