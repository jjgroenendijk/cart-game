import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ImpostorField, type ImpostorAtlas } from "./ImpostorField";
import { impostorAtlasLayout } from "../materials/impostor";
import type { PlacedProp } from "./propSampler";

/** Stub atlas (no GPU bake): two cells keyed by kind. */
function stubAtlas(kinds: string[]): ImpostorAtlas {
  const layout = impostorAtlasLayout(kinds.length);
  const index = new Map(kinds.map((k, i) => [k, i]));
  return {
    albedo: new THREE.Texture(),
    normal: new THREE.Texture(),
    layout,
    cells: kinds.map(() => ({ width: 4, height: 8 })),
    cellForKind: (k) => index.get(k) ?? -1,
    dispose: () => {},
  };
}

function prop(kind: string, x: number, scale = 1): PlacedProp {
  return { x, y: 0, z: 0, normal: new THREE.Vector3(0, 1, 0), kind, seed: 1, scale };
}

describe("ImpostorField", () => {
  it("builds one instanced card per baked-kind placement", () => {
    const atlas = stubAtlas(["tree", "rock"]);
    const field = new ImpostorField([prop("tree", 0), prop("rock", 5), prop("tree", 9)], atlas);
    expect(field.count).toBe(3);
    field.dispose();
  });

  it("drops placements whose kind was not baked into the atlas", () => {
    const atlas = stubAtlas(["tree"]);
    const field = new ImpostorField([prop("tree", 0), prop("bush", 5)], atlas);
    expect(field.count).toBe(1);
    field.dispose();
  });

  it("has no billboards (and no group child) when nothing matches", () => {
    const atlas = stubAtlas(["tree"]);
    const field = new ImpostorField([prop("bush", 0)], atlas);
    expect(field.count).toBe(0);
    expect(field.group.children.length).toBe(0);
    field.dispose();
  });

  it("setFade drives the shared uFade uniform on the card material", () => {
    const atlas = stubAtlas(["tree"]);
    const field = new ImpostorField([prop("tree", 0)], atlas);
    const mesh = field.group.children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uFade.value).toBe(1);
    field.setFade(0.4);
    expect(mat.uniforms.uFade.value).toBeCloseTo(0.4, 6);
    field.dispose();
  });

  it("carries no colliders/physics: instance transforms are translation-only", () => {
    const atlas = stubAtlas(["tree"]);
    const field = new ImpostorField([prop("tree", 7, 2)], atlas);
    const mesh = field.group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(7, 6);
    // Per-instance size lives in the aSize attribute (width/height * scale).
    const aSize = mesh.geometry.getAttribute("aSize");
    expect(aSize.getX(0)).toBeCloseTo(8, 6); // width 4 * scale 2
    expect(aSize.getY(0)).toBeCloseTo(16, 6); // height 8 * scale 2
    field.dispose();
  });
});
