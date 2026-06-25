import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clusterLayout, type ClusterLayoutOptions } from "./cloudCluster";

function positionOf(m: THREE.Matrix4): THREE.Vector3 {
  const p = new THREE.Vector3();
  m.decompose(p, new THREE.Quaternion(), new THREE.Vector3());
  return p;
}

function baseOpts(over: Partial<ClusterLayoutOptions> = {}): ClusterLayoutOptions {
  return {
    clouds: 4,
    puffsPerCloud: 6,
    worldHalfExtent: 100,
    cloudHeight: 60,
    seed: 42,
    ...over,
  };
}

describe("clusterLayout determinism", () => {
  it("same opts -> identical matrices", () => {
    const a = clusterLayout(baseOpts());
    const b = clusterLayout(baseOpts());
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].toArray()).toEqual(b[i].toArray());
    }
  });

  it("different seeds -> different layout", () => {
    const a = clusterLayout(baseOpts({ seed: 1 }));
    const b = clusterLayout(baseOpts({ seed: 2 }));
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      const pa = a[i].toArray();
      const pb = b[i].toArray();
      if (pa.some((v, j) => v !== pb[j])) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });
});

describe("clusterLayout purity", () => {
  it("returns equal results on repeated calls and does not mutate opts", () => {
    const opts = baseOpts();
    const snapshot: ClusterLayoutOptions = { ...opts };
    const a = clusterLayout(opts);
    const b = clusterLayout(opts);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].toArray()).toEqual(b[i].toArray());
    }
    expect(opts).toEqual(snapshot);
  });
});

describe("clusterLayout puff count", () => {
  it("length === clouds * puffsPerCloud for several combos", () => {
    const combos: Array<[number, number]> = [
      [1, 1],
      [3, 6],
      [24, 6],
      [10, 4],
      [0, 6],
      [4, 0],
    ];
    for (const [clouds, puffs] of combos) {
      expect(clusterLayout(baseOpts({ clouds, puffsPerCloud: puffs })).length).toBe(clouds * puffs);
    }
  });
});

describe("clusterLayout bounds", () => {
  it("every puff position stays within [-half, +half] on X and Z", () => {
    const half = 100;
    const mats = clusterLayout(baseOpts({ worldHalfExtent: half, clouds: 24, puffsPerCloud: 6 }));
    expect(mats.length).toBe(24 * 6);
    for (const m of mats) {
      const p = positionOf(m);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(half + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(half + 1e-6);
    }
  });
});

describe("clusterLayout Y bounds", () => {
  it("Y is NOT bounded by worldHalfExtent (only X and Z are)", () => {
    // cloudHeight 1000 + heightJitter 100 -> puff Y far above half 100.
    const mats = clusterLayout(
      baseOpts({ cloudHeight: 1000, heightJitter: 100, worldHalfExtent: 100 }),
    );
    expect(mats.length).toBeGreaterThan(0);
    let aboveHalf = 0;
    for (const m of mats) {
      const p = positionOf(m);
      if (Math.abs(p.y) > 100) aboveHalf++;
    }
    // Every puff sits near cloudHeight 1000, outside the XZ world box.
    expect(aboveHalf).toBe(mats.length);
  });
});

describe("clusterLayout sub-RNG stability", () => {
  it("adding more clouds does not shift earlier clouds' puff layout", () => {
    const a = clusterLayout(baseOpts({ clouds: 4, puffsPerCloud: 6 }));
    const b = clusterLayout(baseOpts({ clouds: 8, puffsPerCloud: 6 }));
    // First cloud's 6 puffs are byte-identical regardless of total count.
    for (let i = 0; i < 6; i++) {
      expect(a[i].toArray()).toEqual(b[i].toArray());
    }
  });
});

describe("clusterLayout large count", () => {
  it("clouds=100 puffsPerCloud=8 returns 800 matrices without throwing", () => {
    const mats = clusterLayout(baseOpts({ clouds: 100, puffsPerCloud: 8 }));
    expect(mats.length).toBe(800);
  });
});
