import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DynamicSky } from "./DynamicSky";
import { dayCycleState } from "./dayCycle";

const MOON_SHELL = 1500;
const DEFAULT_STAR_COUNT = 600;

function starPoints(sky: DynamicSky): THREE.Points {
  return sky.group.children.find((c) => c instanceof THREE.Points) as THREE.Points;
}

function moonMesh(sky: DynamicSky): THREE.Mesh {
  return sky.group.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
}

function starPositions(sky: DynamicSky): Float32Array {
  const attr = starPoints(sky).geometry.getAttribute("position") as THREE.BufferAttribute;
  return attr.array as Float32Array;
}

describe("DynamicSky construction", () => {
  it("group holds stars + moon (2 children)", () => {
    const sky = new DynamicSky();
    expect(sky.group.children.length).toBe(2);
    sky.dispose();
  });

  it("stars are THREE.Points on layer 0 with fog-free transparent material", () => {
    const sky = new DynamicSky();
    const stars = starPoints(sky);
    expect(stars.layers.isEnabled(0)).toBe(true);
    const mat = stars.material as THREE.PointsMaterial;
    expect(mat.fog).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    sky.dispose();
  });

  it("star geometry holds starCount vertices (3 components each)", () => {
    const sky = new DynamicSky();
    const attr = starPoints(sky).geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(attr.count).toBe(DEFAULT_STAR_COUNT);
    expect(attr.itemSize).toBe(3);
    sky.dispose();
  });

  it("moon is a THREE.Mesh on layer 0 with fog-free MeshBasicMaterial", () => {
    const sky = new DynamicSky();
    const moon = moonMesh(sky);
    expect(moon.layers.isEnabled(0)).toBe(true);
    const mat = moon.material as THREE.MeshBasicMaterial;
    expect(mat.fog).toBe(false);
    sky.dispose();
  });

  it("respects custom starCount", () => {
    const sky = new DynamicSky({ starCount: 42 });
    const attr = starPoints(sky).geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(attr.count).toBe(42);
    sky.dispose();
  });
});

describe("DynamicSky star determinism", () => {
  it("same seed -> identical star positions", () => {
    const a = new DynamicSky({ starSeed: 123 });
    const b = new DynamicSky({ starSeed: 123 });
    const pa = starPositions(a);
    const pb = starPositions(b);
    expect(pb.length).toBe(pa.length);
    for (let i = 0; i < pa.length; i++) {
      expect(pb[i]).toBe(pa[i]);
    }
    a.dispose();
    b.dispose();
  });

  it("different seeds -> different positions", () => {
    const a = new DynamicSky({ starSeed: 1 });
    const b = new DynamicSky({ starSeed: 2 });
    const pa = starPositions(a);
    const pb = starPositions(b);
    let diff = 0;
    for (let i = 0; i < pa.length; i++) {
      if (pb[i] !== pa[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
    a.dispose();
    b.dispose();
  });
});

describe("DynamicSky dayStartSeconds", () => {
  it("starts the clock at the requested phase (daytime), not dawn", () => {
    const start = 14; // arbitrary non-zero phase
    const sky = new DynamicSky({ dayStartSeconds: start });
    sky.update(0);
    expect(dayCycleState.elapsed).toBeCloseTo(start, 6);
    expect(dayCycleState.sunElevationDeg).toBeGreaterThan(0); // above horizon, lit
    sky.dispose();
  });

  it("defaults to 0 (dawn) when omitted -> update(0) is dawn elevation 0", () => {
    const sky = new DynamicSky();
    sky.update(0);
    expect(dayCycleState.sunElevationDeg).toBeCloseTo(0, 6);
    sky.dispose();
  });
});

describe("DynamicSky update advances + writes singleton", () => {
  it("update(dt) writes elapsed to the singleton", () => {
    const sky = new DynamicSky();
    sky.update(5);
    expect(dayCycleState.elapsed).toBeCloseTo(5, 6);
    sky.dispose();
  });

  it("sun rises from dawn toward noon (replaces the singleton field ref)", () => {
    const sky = new DynamicSky();
    sky.update(0); // dawn
    const dawn = dayCycleState.sunDirWorld.clone(); // copy: field ref replaced next write
    sky.update(30); // quarter day -> noon
    expect(dayCycleState.sunDirWorld.y).toBeGreaterThan(dawn.y);
    sky.dispose();
  });

  it("nightFactor transitions to night past dusk", () => {
    const sky = new DynamicSky();
    sky.update(0);
    expect(dayCycleState.nightFactor).toBeCloseTo(0, 6);
    sky.update(65); // 65/120 ~ 0.54 -> just past dusk into night
    expect(dayCycleState.nightFactor).toBeGreaterThan(0);
    sky.dispose();
  });
});

describe("DynamicSky moon + stars fade by nightFactor", () => {
  it("dawn (update 0): stars + moon hidden", () => {
    const sky = new DynamicSky();
    sky.update(0);
    const stars = starPoints(sky);
    const moon = moonMesh(sky);
    const sm = stars.material as THREE.PointsMaterial;
    const mm = moon.material as THREE.MeshBasicMaterial;
    expect(sm.opacity).toBeCloseTo(0, 6);
    expect(stars.visible).toBe(false);
    expect(mm.opacity).toBeCloseTo(0, 6);
    expect(moon.visible).toBe(false);
    sky.dispose();
  });

  it("deep night (update 90): stars + moon fully visible", () => {
    const sky = new DynamicSky();
    sky.update(90); // 90/120 = 0.75 deep night
    const stars = starPoints(sky);
    const moon = moonMesh(sky);
    const sm = stars.material as THREE.PointsMaterial;
    const mm = moon.material as THREE.MeshBasicMaterial;
    expect(sm.opacity).toBeCloseTo(1, 6);
    expect(stars.visible).toBe(true);
    expect(mm.opacity).toBeCloseTo(1, 6);
    expect(moon.visible).toBe(true);
    sky.dispose();
  });

  it("moon sits at the anti-sun direction", () => {
    const sky = new DynamicSky();
    sky.update(90);
    const moon = moonMesh(sky);
    const expected = dayCycleState.sunDirWorld.clone().multiplyScalar(-MOON_SHELL);
    expect(moon.position.x).toBeCloseTo(expected.x, 6);
    expect(moon.position.y).toBeCloseTo(expected.y, 6);
    expect(moon.position.z).toBeCloseTo(expected.z, 6);
    sky.dispose();
  });
});

describe("DynamicSky dayLength option", () => {
  it("dayLengthSeconds scales the cycle (2.5/10 -> noon)", () => {
    const sky = new DynamicSky({ dayLengthSeconds: 10 });
    sky.update(2.5);
    expect(dayCycleState.sunElevationDeg).toBeCloseTo(62, 6);
    sky.dispose();
  });
});

describe("DynamicSky dispose", () => {
  it("is idempotent (calling twice does not throw)", () => {
    const sky = new DynamicSky();
    sky.dispose();
    expect(() => sky.dispose()).not.toThrow();
  });
});
