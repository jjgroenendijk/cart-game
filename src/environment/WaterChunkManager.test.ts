import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";
import type { HeightMapField } from "../materials/cel";
import type { Pt } from "../kart/kartLod";
import { WaterChunkManager } from "./WaterChunkManager";

function field(size = 200, origin = -size / 2): HeightMapField {
  const texels = 4;
  const texture = new THREE.DataTexture(new Float32Array(texels * texels), texels, texels);
  return { texture, origin: [origin, origin], size, texels };
}

function tileKeys(m: WaterChunkManager): Set<string> {
  const keys = new Set<string>();
  m.group.children.forEach((c) => {
    if (c.userData.farSkirt) return; // the far-water disc is not a streamed tile
    const p = (c as THREE.Mesh).geometry.getAttribute("position");
    // A tile's mesh sits at identity; its center is the geometry centroid.
    const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
    const cx = Math.round((box.min.x + box.max.x) / 2);
    const cz = Math.round((box.min.z + box.max.z) / 2);
    keys.add(`${cx / 50},${cz / 50}`);
  });
  return keys;
}

describe("WaterChunkManager materials + layers", () => {
  it("tiles live on layer 1 (terrain depth mask) and not layer 0", () => {
    const m = new WaterChunkManager();
    const mesh = m.group.children[0] as THREE.Mesh;
    expect(mesh.layers.isEnabled(1)).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(false);
    m.dispose();
  });

  it("every tile shares ONE CelWaterMaterial and receives shadows", () => {
    const m = new WaterChunkManager({ heightMap: field() });
    const tiles = m.group.children.filter((c) => !c.userData.farSkirt) as THREE.Mesh[];
    const mats = new Set(tiles.map((c) => c.material));
    expect(mats.size).toBe(1);
    const mesh = tiles[0]!;
    expect(mesh.material).toBeInstanceOf(CelWaterMaterial);
    expect(mesh.receiveShadow).toBe(true);
    m.dispose();
  });

  it("binds the heightMap (HEIGHT_MAP define) for depth-aware foam", () => {
    const m = new WaterChunkManager({ heightMap: field() });
    const mat = (m.group.children[0] as THREE.Mesh).material as CelWaterMaterial;
    expect("HEIGHT_MAP" in mat.defines).toBe(true);
    m.dispose();
  });

  it("no heightMap -> legacy facing material (no HEIGHT_MAP define), still tiles", () => {
    const m = new WaterChunkManager();
    const mat = (m.group.children[0] as THREE.Mesh).material as CelWaterMaterial;
    expect("HEIGHT_MAP" in mat.defines).toBe(false);
    expect(m.activeCount).toBeGreaterThan(0);
    m.dispose();
  });

  it("routes color/shallow/deep to the material uniforms", () => {
    const m = new WaterChunkManager({ color: 0x112233, shallow: 0x2db8b8, deep: 0x0a3a55 });
    const mat = (m.group.children[0] as THREE.Mesh).material as CelWaterMaterial;
    expect(mat.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
    expect(mat.uniforms.uShallow.value.getHex()).toBe(new THREE.Color(0x2db8b8).getHex());
    expect(mat.uniforms.uDeep.value.getHex()).toBe(new THREE.Color(0x0a3a55).getHex());
    m.dispose();
  });
});

describe("WaterChunkManager tile geometry", () => {
  it("tiles are flat in XZ at the configured level, authored in world space", () => {
    const m = new WaterChunkManager({ level: -5, chunkSize: 50 });
    const mesh = m.group.children[0] as THREE.Mesh;
    // Mesh transform is identity: world position lives in the geometry verts.
    expect(mesh.position.x).toBe(0);
    expect(mesh.position.z).toBe(0);
    const box = new THREE.Box3().setFromObject(mesh);
    expect(box.min.y).toBeCloseTo(-5, 5);
    expect(box.max.y).toBeCloseTo(-5, 5);
    m.dispose();
  });

  it("adjacent tiles tile seamlessly (shared edge, no gap/overlap)", () => {
    const m = new WaterChunkManager({ chunkSize: 50 });
    const keys = tileKeys(m);
    expect(keys.has("0,0")).toBe(true);
    expect(keys.has("1,0")).toBe(true); // neighbour present -> continuous sheet
    m.dispose();
  });
});

describe("WaterChunkManager field pinning", () => {
  it("pins tiles covering the whole baked field (never culled)", () => {
    const m = new WaterChunkManager({ heightMap: field(200), chunkSize: 50 });
    expect(m.pinnedCount).toBeGreaterThan(0);
    const before = m.activeCount;
    // Drive the focus far away: pinned in-field tiles must survive.
    m.update([{ x: 5000, y: 0, z: 5000 }], 1);
    const keys = tileKeys(m);
    // Field spans [-100,100]; tile (0,0) is dead-center -> still present.
    expect(keys.has("0,0")).toBe(true);
    expect(m.activeCount).toBeLessThanOrEqual(before + 6);
    m.dispose();
  });
});

describe("WaterChunkManager streaming", () => {
  const near: Pt = { x: 0, y: 0, z: 0 };

  it("advances material uTime every update", () => {
    const m = new WaterChunkManager();
    m.update([near], 3.5);
    const mat = (m.group.children[0] as THREE.Mesh).material as CelWaterMaterial;
    expect(mat.uTime).toBe(3.5);
    m.dispose();
  });

  it("empty foci -> advances uTime but streams nothing", () => {
    const m = new WaterChunkManager({ chunkSize: 50, streamRadius: 60, cullRadius: 80 });
    const before = m.activeCount;
    m.update([], 2);
    expect(m.activeCount).toBe(before);
    m.dispose();
  });

  it("activates tiles ahead of a moving focus and culls tiles left behind", () => {
    const m = new WaterChunkManager({
      chunkSize: 50,
      streamRadius: 60,
      cullRadius: 80,
      maxActivations: 99,
    });
    // Settle around origin, then jump the focus far along +x.
    m.update([near], 0);
    m.update([{ x: 1000, y: 0, z: 0 }], 1);
    const keys = tileKeys(m);
    expect(keys.has("20,0")).toBe(true); // 1000/50 = tile 20 now covered
    expect(keys.has("0,0")).toBe(false); // origin left behind -> culled
    m.dispose();
  });

  it("throttles activations to maxActivations per update", () => {
    const m = new WaterChunkManager({
      chunkSize: 50,
      streamRadius: 200,
      cullRadius: 240,
      maxActivations: 2,
    });
    const before = m.activeCount;
    m.update([{ x: 4000, y: 0, z: 0 }], 1);
    // At most `deactivations` removed + 2 added; net active count change bounded.
    expect(m.activeCount).toBeLessThanOrEqual(before + 2);
    m.dispose();
  });
});

describe("WaterChunkManager far-water skirt (071 fog-far)", () => {
  it("builds a flat, facing-only, glint-free disc below the tile troughs", () => {
    const m = new WaterChunkManager({ level: -3, heightMap: field() });
    const skirt = m.farSkirt!;
    expect(skirt).not.toBeNull();
    expect(skirt.userData.farSkirt).toBe(true);
    const mat = skirt.material as CelWaterMaterial;
    // Facing-only fallback: no depth field bound (no seam pop past the ring).
    expect("HEIGHT_MAP" in mat.defines).toBe(false);
    expect(mat.uniforms.uAmp.value).toBe(0); // flat sheet, tiles carry ripples
    expect(mat.glintIntensity).toBe(0); // no specular band on the far disc
    // Sits below the deepest tile trough (level - amp) so tiles always occlude.
    expect(skirt.position.y).toBeLessThan(-3);
    expect(skirt.renderOrder).toBe(1); // drawn after tiles for early-Z
    expect(skirt.layers.isEnabled(1)).toBe(true);
    m.dispose();
  });

  it("radius exceeds the max scene fog-far so the rim saturates to fog", () => {
    const m = new WaterChunkManager();
    const geo = (m.farSkirt as THREE.Mesh).geometry;
    geo.computeBoundingSphere();
    // Max day-cycle fogFar is 360; the rim must be past it (default 480).
    expect(geo.boundingSphere!.radius).toBeGreaterThan(360);
    m.dispose();
  });

  it("inherits the biome water hue for horizon color continuity", () => {
    const m = new WaterChunkManager({ color: 0x112233, deep: 0x0a3a55 });
    const mat = (m.farSkirt as THREE.Mesh).material as CelWaterMaterial;
    expect(mat.uniforms.uTint.value.getHex()).toBe(new THREE.Color(0x112233).getHex());
    expect(mat.uniforms.uDeep.value.getHex()).toBe(new THREE.Color(0x0a3a55).getHex());
    m.dispose();
  });

  it("follows the observer centroid on update", () => {
    const m = new WaterChunkManager();
    m.update([{ x: 200, y: 0, z: 400 }], 1);
    expect(m.farSkirt!.position.x).toBeCloseTo(200, 5);
    expect(m.farSkirt!.position.z).toBeCloseTo(400, 5);
    // Two observers -> disc centers on their midpoint.
    m.update(
      [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
      ],
      2,
    );
    expect(m.farSkirt!.position.x).toBeCloseTo(50, 5);
    m.dispose();
  });

  it("farSkirt:false omits the disc entirely", () => {
    const m = new WaterChunkManager({ farSkirt: false });
    expect(m.farSkirt).toBeNull();
    expect(m.group.children.every((c) => !c.userData.farSkirt)).toBe(true);
    m.dispose();
  });

  it("empty foci leaves the skirt where it was", () => {
    const m = new WaterChunkManager();
    m.update([{ x: 300, y: 0, z: 0 }], 1);
    m.update([], 2);
    expect(m.farSkirt!.position.x).toBeCloseTo(300, 5);
    m.dispose();
  });
});

describe("WaterChunkManager lifecycle", () => {
  it("dispose frees geometry + material, clears the group, idempotent", () => {
    const m = new WaterChunkManager({ heightMap: field() });
    expect(() => m.dispose()).not.toThrow();
    expect(m.group.children).toHaveLength(0);
    expect(() => m.dispose()).not.toThrow();
  });

  it("setGlintIntensity forwards to the shared material", () => {
    const m = new WaterChunkManager();
    m.setGlintIntensity(0);
    const mat = (m.group.children[0] as THREE.Mesh).material as CelWaterMaterial;
    expect(mat.glintIntensity).toBe(0);
    m.dispose();
  });
});
