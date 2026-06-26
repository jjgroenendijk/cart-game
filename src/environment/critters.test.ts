import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { SamplerTerrain } from "./propSampler";
import {
  critterPose,
  placeCritters,
  type CritterOptions,
  type CritterPose,
  type PlacedCritter,
} from "./critters";
import { degToRad } from "../core/math";

/** Ring-of-radius-R stub: corridor distance = |hypot(x,z) - R|. */
function stubTerrain(
  overrides: Partial<{
    heightAt: (x: number, z: number) => number;
    normalY: (x: number, z: number) => number;
    ringR: number;
    spawn: THREE.Vector3;
  }> = {},
): SamplerTerrain {
  const ringR = overrides.ringR ?? 60;
  const spawn = overrides.spawn ?? new THREE.Vector3(62, 0, 0);
  const normalY = overrides.normalY ?? (() => 1);
  return {
    heightAt: overrides.heightAt ?? (() => 0),
    normalAt: (_x, _z, out = new THREE.Vector3()) => {
      const y = normalY(_x, _z);
      const x = Math.sqrt(Math.max(0, 1 - y * y));
      return out.set(x, y, 0);
    },
    startPos: (out = new THREE.Vector3()) => out.copy(spawn),
    spline: {
      closestPoint: (x, z) => ({ dist: Math.abs(Math.hypot(x, z) - ringR) }),
    },
  };
}

function baseOpts(overrides: Partial<CritterOptions> = {}): CritterOptions {
  return {
    seed: 1337,
    worldHalfExtent: 100,
    edgeMargin: 4,
    cell: 8,
    maxAttemptsPerSlot: 4,
    trackHalfWidth: 6,
    corridorMargin: 3,
    spawnExclusionRadius: 12,
    maxSlope: degToRad(35),
    count: 40,
    skyFraction: 0.6,
    ...overrides,
  };
}

const snapshot = (p: PlacedCritter) => ({
  x: +p.x.toFixed(3),
  z: +p.z.toFixed(3),
  baseY: +p.baseY.toFixed(3),
  radius: +p.radius.toFixed(3),
  speed: +p.speed.toFixed(3),
  phase: +p.phase.toFixed(3),
  tilt: +p.tilt.toFixed(3),
  altAmp: +p.altAmp.toFixed(3),
  altFreq: +p.altFreq.toFixed(3),
  scale: +p.scale.toFixed(3),
  seed: p.seed,
  band: p.band,
});

describe("placeCritters — determinism", () => {
  it("same seed + terrain -> identical placement", () => {
    const t = stubTerrain();
    const a = placeCritters(t, baseOpts()).map(snapshot);
    const b = placeCritters(t, baseOpts()).map(snapshot);
    expect(a).toEqual(b);
  });

  it("different seed -> different placement", () => {
    const t = stubTerrain();
    const a = placeCritters(t, baseOpts()).map(snapshot);
    const b = placeCritters(t, baseOpts({ seed: 9999 })).map(snapshot);
    expect(a).not.toEqual(b);
  });
});

describe("placeCritters — rejection rules", () => {
  it("keeps the drivable corridor clear (dist >= trackHalfWidth + margin)", () => {
    const placed = placeCritters(stubTerrain(), baseOpts());
    const min = 6 + 3;
    for (const p of placed) {
      const dist = Math.abs(Math.hypot(p.x, p.z) - 60);
      expect(dist).toBeGreaterThanOrEqual(min - 1e-6);
    }
  });

  it("keeps the spawn point clear", () => {
    const placed = placeCritters(stubTerrain(), baseOpts());
    const spawn = new THREE.Vector3(62, 0, 0);
    for (const p of placed) {
      expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeGreaterThanOrEqual(12 - 1e-6);
    }
  });

  it("keeps anchors inside the world minus edgeMargin", () => {
    const placed = placeCritters(stubTerrain(), baseOpts());
    const limit = 100 - 4;
    for (const p of placed) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(limit + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it("rejects ground steeper than maxSlope", () => {
    const steep = stubTerrain({ normalY: () => 0 });
    const placed = placeCritters(steep, baseOpts());
    expect(placed).toHaveLength(0);
  });

  it("places critters on flat ground", () => {
    const placed = placeCritters(stubTerrain(), baseOpts());
    expect(placed.length).toBeGreaterThan(0);
  });
});

describe("placeCritters — counts", () => {
  it("never exceeds the count cap", () => {
    const placed = placeCritters(stubTerrain(), baseOpts());
    expect(placed.length).toBeLessThanOrEqual(40);
  });

  it("hits the count cap when the area allows", () => {
    const placed = placeCritters(stubTerrain(), baseOpts({ count: 20 }));
    expect(placed.length).toBe(20);
  });
});

describe("placeCritters — bands", () => {
  it("splits critters across sky and ground bands", () => {
    const placed = placeCritters(stubTerrain(), baseOpts({ count: 40, skyFraction: 0.5 }));
    const sky = placed.filter((p) => p.band === "sky");
    const ground = placed.filter((p) => p.band === "ground");
    expect(sky.length).toBeGreaterThan(0);
    expect(ground.length).toBeGreaterThan(0);
    const minSkyBaseY = Math.min(...sky.map((p) => p.baseY));
    const maxGroundBaseY = Math.max(...ground.map((p) => p.baseY));
    expect(minSkyBaseY).toBeGreaterThan(maxGroundBaseY);
    expect(minSkyBaseY).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(maxGroundBaseY).toBeLessThanOrEqual(3.5 + 1e-6);
  });
});

describe("critterPose", () => {
  it("is pure: same (p, t) -> identical pose", () => {
    const placed = placeCritters(stubTerrain(), baseOpts({ count: 20 }));
    const p = placed[0]!;
    const a = critterPose(p, 1.5);
    const b = critterPose(p, 1.5);
    expect(a.pos.x).toBeCloseTo(b.pos.x, 6);
    expect(a.pos.y).toBeCloseTo(b.pos.y, 6);
    expect(a.pos.z).toBeCloseTo(b.pos.z, 6);
    expect(a.yaw).toBe(b.yaw);
    expect(a.scale).toBe(b.scale);
  });

  it("advances with time", () => {
    const placed = placeCritters(stubTerrain(), baseOpts({ count: 20 }));
    const p = placed[0]!;
    const a = critterPose(p, 0);
    const b = critterPose(p, 5);
    const moved =
      a.pos.x !== b.pos.x || a.pos.y !== b.pos.y || a.pos.z !== b.pos.z || a.yaw !== b.yaw;
    expect(moved).toBe(true);
  });

  it("reuses the out parameter when passed", () => {
    const placed = placeCritters(stubTerrain(), baseOpts({ count: 20 }));
    const p = placed[0]!;
    const out: CritterPose = { pos: new THREE.Vector3(99, 99, 99), yaw: 99, scale: 99 };
    const ret = critterPose(p, 2, out);
    expect(ret).toBe(out);
    expect(ret.pos).toBe(out.pos);
    const fresh = critterPose(p, 2);
    expect(ret.pos.x).toBeCloseTo(fresh.pos.x, 6);
    expect(ret.pos.y).toBeCloseTo(fresh.pos.y, 6);
    expect(ret.pos.z).toBeCloseTo(fresh.pos.z, 6);
    expect(ret.yaw).toBe(fresh.yaw);
    expect(ret.scale).toBe(p.scale);
  });
});
