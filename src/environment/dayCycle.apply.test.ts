import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyDayCycleToTargets, computeDayCycle, type DayCycleLightTargets } from "./dayCycle";

/** Fresh dest mirroring the Renderer's live-Three-object target shape. */
function makeDest(): DayCycleLightTargets {
  return {
    sunColor: new THREE.Color(),
    ambientColor: new THREE.Color(),
    fogColor: new THREE.Color(),
    fog: { near: -1, far: -1 },
    sunDirWorld: new THREE.Vector3(),
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
  };
}

describe("applyDayCycleToTargets — noon", () => {
  it("copies an overhead sun direction (y is the largest component, unit len)", () => {
    const dest = makeDest();
    applyDayCycleToTargets(computeDayCycle(30), dest); // 30/120 = 0.25 = noon
    expect(dest.sunDirWorld.y).toBeGreaterThan(Math.abs(dest.sunDirWorld.x));
    expect(dest.sunDirWorld.y).toBeGreaterThan(Math.abs(dest.sunDirWorld.z));
    expect(dest.sunDirWorld.length()).toBeCloseTo(1, 6);
  });

  it("copies fog near/far matching the state's day values (90/360)", () => {
    const dest = makeDest();
    const state = computeDayCycle(30);
    applyDayCycleToTargets(state, dest);
    expect(dest.fog.near).toBeCloseTo(state.fogNear, 6);
    expect(dest.fog.far).toBeCloseTo(state.fogFar, 6);
    expect(dest.fog.near).toBeCloseTo(90, 6);
    expect(dest.fog.far).toBeCloseTo(360, 6);
  });
});

describe("applyDayCycleToTargets — replacement", () => {
  it("replaces stale values on a subsequent call (night -> noon)", () => {
    const dest = makeDest();
    applyDayCycleToTargets(computeDayCycle(90), dest); // deep night
    const nightSunY = dest.sunDirWorld.y;
    expect(nightSunY).toBeLessThan(0); // sun below horizon
    expect(dest.fog.near).toBeLessThan(90); // night fog tighter (70)

    applyDayCycleToTargets(computeDayCycle(30), dest); // back to noon
    expect(dest.sunDirWorld.y).not.toBeCloseTo(nightSunY, 6);
    expect(dest.sunDirWorld.y).toBeGreaterThan(0);
    expect(dest.fog.near).toBeCloseTo(90, 6);
    expect(dest.fog.far).toBeCloseTo(360, 6);
  });

  it("does not swap the dest fog object (mutates near/far in place)", () => {
    const dest = makeDest();
    const fogRef = dest.fog;
    applyDayCycleToTargets(computeDayCycle(90), dest);
    applyDayCycleToTargets(computeDayCycle(30), dest);
    expect(dest.fog).toBe(fogRef);
    expect(dest.fog.near).toBeCloseTo(90, 6);
  });
});

describe("applyDayCycleToTargets — ref identity", () => {
  it("mutates dest Color/Vector3 in place (object identities preserved)", () => {
    const dest = makeDest();
    const sunColorRef = dest.sunColor;
    const ambientRef = dest.ambientColor;
    const fogColorRef = dest.fogColor;
    const sunDirRef = dest.sunDirWorld;
    const zenithRef = dest.skyZenith;
    const horizonRef = dest.skyHorizon;

    applyDayCycleToTargets(computeDayCycle(30), dest);
    applyDayCycleToTargets(computeDayCycle(90), dest);

    expect(dest.sunColor).toBe(sunColorRef);
    expect(dest.ambientColor).toBe(ambientRef);
    expect(dest.fogColor).toBe(fogColorRef);
    expect(dest.sunDirWorld).toBe(sunDirRef);
    expect(dest.skyZenith).toBe(zenithRef);
    expect(dest.skyHorizon).toBe(horizonRef);
  });

  it("copies the state's values into dest (not just untouched refs)", () => {
    const dest = makeDest();
    const state = computeDayCycle(0); // dawn
    applyDayCycleToTargets(state, dest);
    expect(dest.sunColor.r).toBeCloseTo(state.sunColor.r, 6);
    expect(dest.skyZenith.b).toBeCloseTo(state.skyZenith.b, 6);
    expect(dest.fogColor.g).toBeCloseTo(state.fogColor.g, 6);
    expect(dest.ambientColor.b).toBeCloseTo(state.ambientColor.b, 6);
  });
});
