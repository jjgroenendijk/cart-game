import { describe, expect, it } from "vitest";
import { makeRNG } from "../../../core/rng";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers the 6 autumn kinds
import {
  buildAutumnTree,
  buildAutumnOak,
  buildMossRock,
  buildMushroom,
  buildFern,
  buildLeafLitter,
  mossRockRadius,
} from "./flora";

/**
 * Autumn flora registration + builder smoke tests. Mirrors the tundra suite:
 * asserts the 6 kinds register with the right big/collider contract, the
 * mossRock radius fn stays in lockstep with its visual, and each builder
 * produces a disposable BuiltProp with real geometry. All jsdom-safe (builders
 * use CelMaterial/BufferGeometry, no WebGL).
 */

const AUTUMN_KINDS = [
  "autumnTree",
  "autumnOak",
  "mossRock",
  "mushroom",
  "fern",
  "leafLitter",
] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("autumn flora — registration", () => {
  it("all 6 autumn kinds are registered", () => {
    for (const kind of AUTUMN_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("autumnTree/autumnOak/mossRock are big; mushroom/fern/leafLitter are decor", () => {
    expect(floraFor("autumnTree").big).toBe(true);
    expect(floraFor("autumnOak").big).toBe(true);
    expect(floraFor("mossRock").big).toBe(true);
    expect(floraFor("mushroom").big).toBe(false);
    expect(floraFor("fern").big).toBe(false);
    expect(floraFor("leafLitter").big).toBe(false);
  });
});

describe("autumn flora — collider contract", () => {
  it("autumnTree + autumnOak are cylinder colliders", () => {
    expect(floraFor("autumnTree").collider.shape).toBe("cylinder");
    expect(floraFor("autumnOak").collider.shape).toBe("cylinder");
  });

  it("mossRock is a ball collider whose radius fn matches mossRockRadius", () => {
    const collider = floraFor("mossRock").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(123)).toBe(mossRockRadius(123));
    }
  });

  it("mushroom/fern/leafLitter are collider:none", () => {
    expect(floraFor("mushroom").collider.shape).toBe("none");
    expect(floraFor("fern").collider.shape).toBe("none");
    expect(floraFor("leafLitter").collider.shape).toBe("none");
  });
});

describe("autumn flora — builders produce disposable geometry", () => {
  it("autumnTree builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildAutumnTree(seed));
    }
  });

  it("autumnOak builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildAutumnOak(seed));
    }
  });

  it("mossRock builds + disposes for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(buildMossRock(seed));
    }
  });

  it("mushroom/fern/leafLitter build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(buildMushroom());
    assertBuildsAndDisposes(buildFern());
    assertBuildsAndDisposes(buildLeafLitter());
  });
});

describe("autumn flora — mossRock radius determinism", () => {
  it("mossRockRadius(s) is stable + equals its documented first RNG draw", () => {
    for (const seed of [0, 7, 12345]) {
      const r = mossRockRadius(seed);
      expect(r).toBe(mossRockRadius(seed));
      expect(r).toBe(makeRNG(seed).range(1.0, 1.9));
    }
  });
});
