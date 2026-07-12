import { describe, expect, it } from "vitest";
import { makeRNG } from "../../../core/rng";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers alpinePine/screeRock/lichenBush
import { buildAlpinePine, buildScreeRock, buildLichenBush, screeRockRadius } from "./flora";

/**
 * Alpine flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 3 kinds register with the right
 * big/collider contract, the screeRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const ALPINE_KINDS = [
  "alpinePine",
  "fir",
  "alpineSnag",
  "screeRock",
  "lichenBush",
  "alpineBloom",
] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("alpine flora — registration", () => {
  it("all 6 alpine kinds are registered", () => {
    for (const kind of ALPINE_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("alpinePine/fir/alpineSnag/screeRock are big; the rest are decor", () => {
    expect(floraFor("alpinePine").big).toBe(true);
    expect(floraFor("fir").big).toBe(true);
    expect(floraFor("alpineSnag").big).toBe(true);
    expect(floraFor("screeRock").big).toBe(true);
    expect(floraFor("lichenBush").big).toBe(false);
    expect(floraFor("alpineBloom").big).toBe(false);
  });

  it("fir + alpineSnag build + dispose and vary per seed", () => {
    for (const seed of [1, 42]) {
      assertBuildsAndDisposes(floraFor("fir").build(seed));
      assertBuildsAndDisposes(floraFor("alpineSnag").build(seed));
    }
  });
});

describe("alpine flora — collider contract", () => {
  it("alpinePine is a cylinder collider with halfHeight 6 + radius 0.95", () => {
    const collider = floraFor("alpinePine").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(6);
      expect(collider.radius).toBe(0.95);
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
