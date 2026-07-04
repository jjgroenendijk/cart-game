import { describe, expect, it } from "vitest";
import { makeRNG } from "../../core/rng";
import type { BuiltProp } from "../propFactory";
import { floraFor, isRegisteredFlora } from "../floraRegistry";
import "./tropical"; // side-effect: registers palm/jungleRock/fernShrub/tropicalFlower
import {
  buildPalm,
  buildJungleRock,
  buildFernShrub,
  buildTropicalFlower,
  jungleRockRadius,
} from "./tropical";

/**
 * Tropical flora registration + builder smoke tests. Mirrors
 * floraRegistry.test.ts: asserts the 4 kinds register with the right
 * big/collider contract, the jungleRock radius fn stays in lockstep with its
 * visual, and each builder produces a disposable BuiltProp with real
 * geometry. All jsdom-safe (builders use CelMaterial/BufferGeometry, no WebGL).
 */

const TROPICAL_KINDS = ["palm", "jungleRock", "fernShrub", "tropicalFlower"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("tropical flora — registration", () => {
  it("palm/jungleRock/fernShrub/tropicalFlower are all registered", () => {
    for (const kind of TROPICAL_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("palm + jungleRock are big; fernShrub + tropicalFlower are decor", () => {
    expect(floraFor("palm").big).toBe(true);
    expect(floraFor("jungleRock").big).toBe(true);
    expect(floraFor("fernShrub").big).toBe(false);
    expect(floraFor("tropicalFlower").big).toBe(false);
  });
});

describe("tropical flora — collider contract", () => {
  it("palm is a cylinder collider with halfHeight 2.0 + radius 0.5", () => {
    const collider = floraFor("palm").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2.0);
      expect(collider.radius).toBe(0.5);
    }
  });

  it("jungleRock is a ball collider whose radius fn matches jungleRockRadius", () => {
    const collider = floraFor("jungleRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(jungleRockRadius(123));
    }
  });

  it("fernShrub + tropicalFlower are collider:none", () => {
    expect(floraFor("fernShrub").collider.shape).toBe("none");
    expect(floraFor("tropicalFlower").collider.shape).toBe("none");
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

  it("fernShrub + tropicalFlower build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildFernShrub());
    assertBuildsAndDisposes(buildTropicalFlower());
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
