import { describe, expect, it } from "vitest";
import { makeRNG } from "../../core/rng";
import type { BuiltProp } from "../propFactory";
import { floraFor, isRegisteredFlora } from "../floraRegistry";
import "./alpine"; // side-effect: registers alpinePine/screeRock/lichenBush
import { buildAlpinePine, buildScreeRock, buildLichenBush, screeRockRadius } from "./alpine";

/**
 * Alpine flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 3 kinds register with the right
 * big/collider contract, the screeRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const ALPINE_KINDS = ["alpinePine", "screeRock", "lichenBush"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("alpine flora — registration", () => {
  it("alpinePine/screeRock/lichenBush are all registered", () => {
    for (const kind of ALPINE_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("alpinePine + screeRock are big; lichenBush is decor", () => {
    expect(floraFor("alpinePine").big).toBe(true);
    expect(floraFor("screeRock").big).toBe(true);
    expect(floraFor("lichenBush").big).toBe(false);
  });
});

describe("alpine flora — collider contract", () => {
  it("alpinePine is a cylinder collider with halfHeight 2.5 + radius 0.5", () => {
    const collider = floraFor("alpinePine").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2.5);
      expect(collider.radius).toBe(0.5);
    }
  });

  it("screeRock is a ball collider whose radius fn matches screeRockRadius", () => {
    const collider = floraFor("screeRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(screeRockRadius(123));
    }
  });

  it("lichenBush is collider:none", () => {
    expect(floraFor("lichenBush").collider.shape).toBe("none");
  });
});

describe("alpine flora — builders produce disposable geometry", () => {
  it("alpinePine builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildAlpinePine(seed));
    }
  });

  it("screeRock builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildScreeRock(seed));
    }
  });

  it("lichenBush builds + disposes (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildLichenBush());
  });
});

describe("alpine flora — screeRock radius determinism", () => {
  it("screeRockRadius(s) is stable + equals its documented first RNG draw", () => {
    for (const seed of [0, 7, 12345]) {
      const r = screeRockRadius(seed);
      expect(r).toBe(screeRockRadius(seed));
      expect(r).toBe(makeRNG(seed).range(0.8, 1.5));
    }
  });
});
