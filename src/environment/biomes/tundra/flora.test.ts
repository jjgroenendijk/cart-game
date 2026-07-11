import { describe, expect, it } from "vitest";
import { makeRNG } from "../../../core/rng";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers pine/iceRock/snowBush
import { buildPine, buildIceRock, buildSnowBush, iceRockRadius } from "./flora";

/**
 * Tundra flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 3 kinds register with the right
 * big/collider contract, the iceRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const TUNDRA_KINDS = ["pine", "iceRock", "snowBush"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("tundra flora — registration", () => {
  it("pine/iceRock/snowBush are all registered", () => {
    for (const kind of TUNDRA_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("pine + iceRock are big; snowBush is decor", () => {
    expect(floraFor("pine").big).toBe(true);
    expect(floraFor("iceRock").big).toBe(true);
    expect(floraFor("snowBush").big).toBe(false);
  });
});

describe("tundra flora — collider contract", () => {
  it("pine is a cylinder collider with halfHeight 2.5 + radius 0.8", () => {
    const collider = floraFor("pine").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2.5);
      expect(collider.radius).toBe(0.8);
    }
  });

  it("iceRock is a ball collider whose radius fn matches iceRockRadius", () => {
    const collider = floraFor("iceRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(iceRockRadius(123));
    }
  });

  it("snowBush is collider:none", () => {
    expect(floraFor("snowBush").collider.shape).toBe("none");
  });
});

describe("tundra flora — builders produce disposable geometry", () => {
  it("pine builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildPine(seed));
    }
  });

  it("iceRock builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildIceRock(seed));
    }
  });

  it("snowBush builds + disposes (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildSnowBush());
  });
});

describe("tundra flora — iceRock radius determinism", () => {
  it("iceRockRadius(s) is stable + equals its documented first RNG draw", () => {
    for (const seed of [0, 7, 12345]) {
      const r = iceRockRadius(seed);
      expect(r).toBe(iceRockRadius(seed));
      expect(r).toBe(makeRNG(seed).range(0.8, 1.5));
    }
  });
});
