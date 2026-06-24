import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyKartLodGroup,
  DEFAULT_KART_LOD,
  kartLod,
  nearestCameraDistance,
  type KartLodResult,
} from "./kartLod";

describe("kartLod — raw thresholds (prevLevel undefined)", () => {
  it("distance 10 (< near 25) -> full: castShadow true, detail true", () => {
    expect(kartLod(10)).toEqual({ level: "full", castShadow: true, detail: true });
  });

  it("distance 40 (near 25..mid 70) -> reduced: castShadow true, detail false", () => {
    expect(kartLod(40)).toEqual({ level: "reduced", castShadow: true, detail: false });
  });

  it("distance 80 (> mid 70) -> minimal: castShadow false, detail false", () => {
    expect(kartLod(80)).toEqual({ level: "minimal", castShadow: false, detail: false });
  });

  it("exactly near (25) -> reduced (strict <, not <=)", () => {
    expect(kartLod(DEFAULT_KART_LOD.near).level).toBe("reduced");
  });

  it("exactly mid (70) -> minimal (strict <, not <=)", () => {
    expect(kartLod(DEFAULT_KART_LOD.mid).level).toBe("minimal");
  });
});

describe("kartLod — hysteresis with prevLevel (DEFAULT_KART_LOD)", () => {
  it("prev full: holds full below near+hys (distance 27 -> full)", () => {
    expect(kartLod(27, "full").level).toBe("full");
  });

  it("prev full: falls to reduced past near+hys (distance 31 -> reduced)", () => {
    expect(kartLod(31, "full").level).toBe("reduced");
  });

  it("prev reduced: holds reduced above near-hys (distance 22 -> reduced)", () => {
    expect(kartLod(22, "reduced").level).toBe("reduced");
  });

  it("prev reduced: rises to full below near-hys (distance 19 -> full)", () => {
    expect(kartLod(19, "reduced").level).toBe("full");
  });

  it("prev reduced: holds reduced below mid+hys (distance 72 -> reduced)", () => {
    expect(kartLod(72, "reduced").level).toBe("reduced");
  });

  it("prev reduced: falls to minimal past mid+hys (distance 76 -> minimal)", () => {
    expect(kartLod(76, "reduced").level).toBe("minimal");
  });

  it("prev minimal: holds minimal above mid-hys (distance 68 -> minimal)", () => {
    expect(kartLod(68, "minimal").level).toBe("minimal");
  });

  it("prev minimal: drops to reduced below mid-hys (distance 64 -> reduced)", () => {
    expect(kartLod(64, "minimal").level).toBe("reduced");
  });
});

describe("kartLod — custom opts override near/mid/hysteresis", () => {
  it("custom near=10, mid=20 pin the raw bands", () => {
    const opts = { near: 10, mid: 20, hysteresis: 2 };
    expect(kartLod(5, undefined, opts).level).toBe("full");
    expect(kartLod(15, undefined, opts).level).toBe("reduced");
    expect(kartLod(25, undefined, opts).level).toBe("minimal");
  });

  it("custom hys widens the full hold (prev full, near=10, hys=5)", () => {
    const opts = { near: 10, mid: 20, hysteresis: 5 };
    expect(kartLod(13, "full", opts).level).toBe("full");
    expect(kartLod(16, "full", opts).level).toBe("reduced");
  });
});

describe("nearestCameraDistance (pure)", () => {
  it("single cam returns its Euclidean distance (3-4-5 triangle)", () => {
    const d = nearestCameraDistance({ x: 0, y: 0, z: 0 }, [{ x: 3, y: 4, z: 0 }]);
    expect(d).toBeCloseTo(5, 6);
  });

  it("two cams returns the min distance", () => {
    const d = nearestCameraDistance({ x: 0, y: 0, z: 0 }, [
      { x: 10, y: 0, z: 0 },
      { x: 1, y: 2, z: 2 },
    ]);
    expect(d).toBeCloseTo(3, 6);
  });

  it("empty cams -> Infinity (kart always treated as far)", () => {
    expect(nearestCameraDistance({ x: 0, y: 0, z: 0 }, [])).toBe(Infinity);
  });
});

describe("applyKartLodGroup — live THREE group walker", () => {
  const build = (): THREE.Group => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05));
    spoke.userData.kartDetail = true;
    g.add(body, spoke);
    return g;
  };

  it("full: both castShadow true, detail mesh visible, lod tag set", () => {
    const g = build();
    const body = g.children[0] as THREE.Mesh;
    const spoke = g.children[1] as THREE.Mesh;
    const res: KartLodResult = { level: "full", castShadow: true, detail: true };
    applyKartLodGroup(g, res);
    expect(g.userData.lod).toBe("full");
    expect(body.castShadow).toBe(true);
    expect(spoke.castShadow).toBe(true);
    expect(spoke.visible).toBe(true);
  });

  it("reduced: both castShadow true, detail mesh hidden", () => {
    const g = build();
    const body = g.children[0] as THREE.Mesh;
    const spoke = g.children[1] as THREE.Mesh;
    applyKartLodGroup(g, { level: "reduced", castShadow: true, detail: false });
    expect(g.userData.lod).toBe("reduced");
    expect(body.castShadow).toBe(true);
    expect(spoke.castShadow).toBe(true);
    expect(spoke.visible).toBe(false);
  });

  it("minimal: both castShadow false, detail mesh hidden", () => {
    const g = build();
    const body = g.children[0] as THREE.Mesh;
    const spoke = g.children[1] as THREE.Mesh;
    applyKartLodGroup(g, { level: "minimal", castShadow: false, detail: false });
    expect(g.userData.lod).toBe("minimal");
    expect(body.castShadow).toBe(false);
    expect(spoke.castShadow).toBe(false);
    expect(spoke.visible).toBe(false);
  });
});
