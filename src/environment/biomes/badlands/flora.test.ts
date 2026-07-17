import { describe, expect, it } from "vitest";
import type { BuiltProp } from "../../propFactory";
import { floraFor, isRegisteredFlora } from "../../floraRegistry";
import "./flora"; // side-effect: registers the 4 badlands kinds

/**
 * Badlands flora registration + builder smoke tests. Mirrors
 * desert/flora.test.ts: asserts the 4 archetype-built kinds register with the
 * right big/collider contract and that each builder produces a disposable
 * BuiltProp with real geometry. All jsdom-safe (builders use
 * CelMaterial/BufferGeometry, no WebGL).
 */

const BADLANDS_KINDS = ["juniper", "butteRock", "scrubBrush", "dryTuft"] as const;

/** Assert a BuiltProp has a non-empty position attribute and a clean dispose. */
function assertBuildsAndDisposes(prop: BuiltProp): void {
  expect(prop.geometry.attributes.position.count).toBeGreaterThan(0);
  expect(() => prop.dispose()).not.toThrow();
}

describe("badlands flora — registration", () => {
  it("all 4 badlands kinds are registered", () => {
    for (const kind of BADLANDS_KINDS) {
      expect(isRegisteredFlora(kind)).toBe(true);
    }
  });

  it("juniper/butteRock are big; scrubBrush/dryTuft are decor", () => {
    expect(floraFor("juniper").big).toBe(true);
    expect(floraFor("butteRock").big).toBe(true);
    expect(floraFor("scrubBrush").big).toBe(false);
    expect(floraFor("dryTuft").big).toBe(false);
  });
});

describe("badlands flora — collider contract", () => {
  it("juniper is a cylinder collider; butteRock is a ball collider", () => {
    expect(floraFor("juniper").collider.shape).toBe("cylinder");
    expect(floraFor("butteRock").collider.shape).toBe("ball");
  });

  it("scrubBrush + dryTuft are collider:none", () => {
    for (const kind of ["scrubBrush", "dryTuft"]) {
      expect(floraFor(kind).collider.shape).toBe("none");
    }
  });
});

describe("badlands flora — builders produce disposable geometry", () => {
  it("juniper + butteRock build + dispose for a couple of seeds", () => {
    for (const seed of [1, 42, 9999]) {
      assertBuildsAndDisposes(floraFor("juniper").build(seed));
      assertBuildsAndDisposes(floraFor("butteRock").build(seed));
    }
  });

  it("scrubBrush + dryTuft build + dispose (shared template, seed ignored)", () => {
    assertBuildsAndDisposes(floraFor("scrubBrush").build(0));
    assertBuildsAndDisposes(floraFor("dryTuft").build(0));
  });
});
