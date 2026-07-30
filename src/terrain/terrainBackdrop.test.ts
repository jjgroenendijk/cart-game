import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TerrainBackdrop } from "./terrainBackdrop";
import { type HeightSource, type Rgb, type Vec3 } from "./heightSource";

const src: HeightSource = {
  heightAt: (x, z) => 0.05 * (x + z),
  colorAt: (_x, _z, out: Rgb = [0, 0, 0]): Rgb => {
    out[0] = 0.3;
    out[1] = 0.4;
    out[2] = 0.5;
    return out;
  },
  normalAt: (_x, _z, out: Vec3 = [0, 0, 0]): Vec3 => {
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
    return out;
  },
};

function make(): TerrainBackdrop {
  return new TerrainBackdrop(src, {
    innerRadius: 100,
    outerRadius: 260,
    radialSegments: 6,
    angularSegments: 16,
    recenterStep: 48,
  });
}

describe("TerrainBackdrop", () => {
  it("builds no mesh until the first update (lazy)", () => {
    const b = make();
    expect(b.group.children.length).toBe(0);
    b.dispose();
  });

  it("first update builds one layer-1 mesh, never frustum-culled", () => {
    const b = make();
    b.update([{ x: 0, y: 0, z: 0 }]);
    expect(b.group.children.length).toBe(1);
    const mesh = b.group.children[0] as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.layers.isEnabled(1)).toBe(true);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.receiveShadow).toBe(true);
    b.dispose();
  });

  it("recentre within the snap cell is a no-op (reuses the same geometry)", () => {
    const b = make();
    b.update([{ x: 0, y: 0, z: 0 }]);
    const geo = (b.group.children[0] as THREE.Mesh).geometry;
    // Move less than recenterStep (48) -> snaps to the same centre.
    b.update([{ x: 20, y: 0, z: -10 }]);
    expect((b.group.children[0] as THREE.Mesh).geometry).toBe(geo);
    b.dispose();
  });

  it("crossing a snap cell rebuilds the geometry (one mesh, geometry swapped)", () => {
    const b = make();
    b.update([{ x: 0, y: 0, z: 0 }]);
    const geo = (b.group.children[0] as THREE.Mesh).geometry;
    b.update([{ x: 200, y: 0, z: 0 }]);
    expect(b.group.children.length).toBe(1);
    expect((b.group.children[0] as THREE.Mesh).geometry).not.toBe(geo);
    b.dispose();
  });

  it("empty foci is a no-op (an observerless frame changes nothing)", () => {
    const b = make();
    b.update([]);
    expect(b.group.children.length).toBe(0);
    b.dispose();
  });

  it("dispose clears the group and is idempotent", () => {
    const b = make();
    b.update([{ x: 0, y: 0, z: 0 }]);
    b.dispose();
    expect(b.group.children.length).toBe(0);
    b.update([{ x: 300, y: 0, z: 0 }]); // no-op after dispose
    expect(b.group.children.length).toBe(0);
    b.dispose();
  });
});
