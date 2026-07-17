import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildKartBody, KART_MODELS, modelById, wheelOffsetsFor, type KartBodyCtx } from ".";
import { KART_VARIANTS, type KartVariantId } from "../kartVariants";
import { makeCel } from "../../materials/cel";

const MODEL_IDS: KartVariantId[] = KART_VARIANTS.map((v) => v.id);

function buildCtx(id: KartVariantId): KartBodyCtx {
  const variant = KART_VARIANTS.find((v) => v.id === id)!;
  return {
    group: new THREE.Group(),
    bodyMat: makeCel({ color: 0xff5252 }),
    accentMat: makeCel({ color: 0xffd23f }),
    darkMat: makeCel({ color: 0x1a1a1f }),
    silhouette: variant.silhouette,
  };
}

/** All meshes parented anywhere under the group. */
function partMeshes(group: THREE.Group): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) out.push(mesh);
  });
  return out;
}

/** Order-independent shape signature: sorted geometry types + positions. */
function signature(group: THREE.Group): string {
  return partMeshes(group)
    .map((m) => `${m.geometry.type}@${m.position.toArray().join(",")}`)
    .sort()
    .join("|");
}

describe("kartModels — wheel stances (083)", () => {
  it("every model has 4 offsets: symmetric x, shared y=-0.35, front pair forward", () => {
    for (const id of MODEL_IDS) {
      const offs = wheelOffsetsFor(id);
      expect(offs).toHaveLength(4);
      for (const o of offs) expect(o.y).toBe(-0.35);
      expect(offs[0]!.x).toBe(-offs[1]!.x);
      expect(offs[2]!.x).toBe(-offs[3]!.x);
      // Front (steering) pair sits ahead of the rear pair (-Z is forward).
      expect(offs[0]!.z).toBeLessThan(offs[2]!.z);
      expect(offs[0]!.z).toBe(offs[1]!.z);
      expect(offs[2]!.z).toBe(offs[3]!.z);
    }
  });

  it("stances differ across models (no shared track/wheelbase everywhere)", () => {
    const keys = new Set(
      MODEL_IDS.map((id) =>
        wheelOffsetsFor(id)
          .map((o) => `${o.x},${o.z}`)
          .join(";"),
      ),
    );
    expect(keys.size).toBe(MODEL_IDS.length);
  });
});

describe("kartModels — chassis builders (083)", () => {
  it("every model builds a non-empty, visually distinct chassis", () => {
    const signatures = new Set<string>();
    for (const id of MODEL_IDS) {
      const ctx = buildCtx(id);
      buildKartBody(id, ctx);
      expect(partMeshes(ctx.group).length).toBeGreaterThanOrEqual(6);
      signatures.add(signature(ctx.group));
    }
    expect(signatures.size).toBe(MODEL_IDS.length);
  });

  it("every model uses all three materials (body, accent, dark)", () => {
    for (const id of MODEL_IDS) {
      const ctx = buildCtx(id);
      buildKartBody(id, ctx);
      const mats = new Set(partMeshes(ctx.group).map((m) => m.material));
      expect(mats.has(ctx.bodyMat)).toBe(true);
      expect(mats.has(ctx.accentMat)).toBe(true);
      expect(mats.has(ctx.darkMat)).toBe(true);
    }
  });

  it("keeps the balanced stance stable (VFX contact points depend on it)", () => {
    expect(wheelOffsetsFor("balanced")).toEqual([
      { x: -0.62, y: -0.35, z: -0.78 },
      { x: 0.62, y: -0.35, z: -0.78 },
      { x: -0.62, y: -0.35, z: 0.82 },
      { x: 0.62, y: -0.35, z: 0.82 },
    ]);
  });

  it("every silhouette is dominated by rounded geometry, not boxes", () => {
    const CURVED = new Set([
      "SphereGeometry",
      "CapsuleGeometry",
      "CylinderGeometry",
      "ConeGeometry",
      "TorusGeometry",
    ]);
    for (const id of MODEL_IDS) {
      const ctx = buildCtx(id);
      buildKartBody(id, ctx);
      const parts = partMeshes(ctx.group);
      const curved = parts.filter((m) => CURVED.has(m.geometry.type));
      const boxes = parts.filter((m) => m.geometry.type === "BoxGeometry");
      expect(curved.length).toBeGreaterThanOrEqual(5);
      expect(boxes.length).toBeLessThan(parts.length / 3);
    }
  });

  it("signature parts exist: cone nose (speed), roll hoop (feather), spare (trail)", () => {
    const speedCtx = buildCtx("speed");
    buildKartBody("speed", speedCtx);
    expect(partMeshes(speedCtx.group).some((m) => m.geometry.type === "ConeGeometry")).toBe(true);

    const featherCtx = buildCtx("feather");
    buildKartBody("feather", featherCtx);
    expect(partMeshes(featherCtx.group).some((m) => m.geometry.type === "TorusGeometry")).toBe(
      true,
    );

    const trailCtx = buildCtx("trail");
    buildKartBody("trail", trailCtx);
    const spare = partMeshes(trailCtx.group).find(
      (m) => m.geometry.type === "CylinderGeometry" && m.position.z > 0.9,
    );
    expect(spare).toBeTruthy();
  });
});

describe("kart model registry", () => {
  it("registers unique ids and modelById resolves each of them", () => {
    const ids = KART_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(KART_MODELS.length);
    for (const id of ids) expect(modelById(id).id).toBe(id);
  });

  it("throws on an unknown model id", () => {
    expect(() => modelById("hovercraft" as KartVariantId)).toThrow(/unknown model id/);
  });

  it("registry order drives the derived KART_VARIANTS", () => {
    expect(KART_VARIANTS.map((v) => v.id)).toEqual(KART_MODELS.map((m) => m.id));
    for (let i = 0; i < KART_MODELS.length; i++) {
      expect(KART_VARIANTS[i]!.name).toBe(KART_MODELS[i]!.name);
      expect(KART_VARIANTS[i]!.tuning).toBe(KART_MODELS[i]!.tuning);
    }
  });
});
