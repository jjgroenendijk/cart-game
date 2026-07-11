import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelMaterial } from "../materials/cel";
import type { BuiltProp } from "./propFactory";
import "../biomes/temperate/flora"; // side-effect: registers the 5 temperate kinds
import {
  floraFor,
  isRegisteredFlora,
  registerFlora,
  registeredFloraKinds,
  type FloraBuilder,
  type FloraCollider,
} from "./floraRegistry";

/**
 * Minimal BuiltProp stub for registry tests. Registry tests assert builder
 * identity + collider shape, never geometry, so a trivial BufferGeometry +
 * default CelMaterial is enough (mirrors the jsdom-safe stubs in cel.test.ts).
 */
function stubBuiltProp(): BuiltProp {
  const geometry = new THREE.BufferGeometry();
  const material = new CelMaterial();
  return {
    geometry,
    material,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A builder whose build fn ignores seed (registry tests never invoke it). */
function stubBuilder(big: boolean, collider: FloraCollider): FloraBuilder {
  return { build: () => stubBuiltProp(), big, collider };
}

describe("floraRegistry — registerFlora + floraFor round-trip", () => {
  it("floraFor returns the exact builder object registered", () => {
    const builder = stubBuilder(true, {
      shape: "cylinder",
      halfHeight: 1.5,
      radius: 0.6,
    });
    registerFlora("fake-cyl", builder);
    expect(floraFor("fake-cyl")).toBe(builder);
  });

  it("re-registering a kind overwrites the previous builder", () => {
    const a = stubBuilder(true, { shape: "none" });
    const b = stubBuilder(false, { shape: "none" });
    registerFlora("fake-overwrite", a);
    expect(floraFor("fake-overwrite")).toBe(a);
    registerFlora("fake-overwrite", b);
    expect(floraFor("fake-overwrite")).toBe(b);
  });
});

describe("floraRegistry — lookup errors", () => {
  it("floraFor throws a clear Error on an unregistered kind", () => {
    expect(() => floraFor("does-not-exist-xyz")).toThrowError(
      /unknown flora kind "does-not-exist-xyz"/,
    );
  });
});

describe("floraRegistry — isRegisteredFlora", () => {
  it("false before registering, true after", () => {
    expect(isRegisteredFlora("fake-presence")).toBe(false);
    registerFlora("fake-presence", stubBuilder(false, { shape: "none" }));
    expect(isRegisteredFlora("fake-presence")).toBe(true);
  });
});

describe("floraRegistry — registeredFloraKinds", () => {
  it("includes a kind after registering it", () => {
    registerFlora("fake-listed", stubBuilder(false, { shape: "none" }));
    expect(registeredFloraKinds()).toContain("fake-listed");
  });
});

describe("floraRegistry — collider shape dispatch", () => {
  it("cylinder / ball / none colliders come back with the right shape", () => {
    const cyl = stubBuilder(true, {
      shape: "cylinder",
      halfHeight: 1.5,
      radius: 0.6,
    });
    const ball = stubBuilder(true, {
      shape: "ball",
      radius: () => 1.2,
      bury: 0.3,
    });
    const none = stubBuilder(false, { shape: "none" });
    registerFlora("fake-collider-cyl", cyl);
    registerFlora("fake-collider-ball", ball);
    registerFlora("fake-collider-none", none);

    expect(floraFor("fake-collider-cyl").collider.shape).toBe("cylinder");
    expect(floraFor("fake-collider-ball").collider.shape).toBe("ball");
    expect(floraFor("fake-collider-none").collider.shape).toBe("none");
  });

  it("ball collider preserves the per-seed radius fn + bury", () => {
    const radius = (seed: number) => seed * 0.1;
    registerFlora("fake-ball-fn", stubBuilder(true, { shape: "ball", radius, bury: 0.25 }));
    const collider = floraFor("fake-ball-fn").collider;
    expect(collider.shape).toBe("ball");
    if (collider.shape === "ball") {
      expect(collider.radius(2)).toBeCloseTo(0.2, 6);
      expect(collider.bury).toBe(0.25);
    }
  });

  it("cylinder collider preserves halfHeight + radius", () => {
    registerFlora(
      "fake-cyl-fields",
      stubBuilder(true, { shape: "cylinder", halfHeight: 2, radius: 0.5 }),
    );
    const collider = floraFor("fake-cyl-fields").collider;
    expect(collider.shape).toBe("cylinder");
    if (collider.shape === "cylinder") {
      expect(collider.halfHeight).toBe(2);
      expect(collider.radius).toBe(0.5);
    }
  });
});

describe("floraRegistry — temperate kinds loaded at module import", () => {
  // The temperate module registers 5 kinds globally; assert presence (not
  // order/count) since future biomes may add more before this test runs.
  it("tree/rock/bush/flower/grass are registered", () => {
    expect(isRegisteredFlora("tree")).toBe(true);
    expect(isRegisteredFlora("rock")).toBe(true);
    expect(isRegisteredFlora("bush")).toBe(true);
    expect(isRegisteredFlora("flower")).toBe(true);
    expect(isRegisteredFlora("grass")).toBe(true);
  });

  it("tree is big + cylinder, rock is big + ball, decor are not big + none", () => {
    expect(floraFor("tree").big).toBe(true);
    expect(floraFor("tree").collider.shape).toBe("cylinder");
    expect(floraFor("rock").big).toBe(true);
    expect(floraFor("rock").collider.shape).toBe("ball");
    for (const kind of ["bush", "flower", "grass"] as const) {
      expect(floraFor(kind).big).toBe(false);
      expect(floraFor(kind).collider.shape).toBe("none");
    }
  });
});
