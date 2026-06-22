import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeCel, type CelMaterial } from "../materials/cel";
import { makeRNG, type RNG } from "../core/rng";

/**
 * Procedural prop geometry + cel materials for 004. Big props (tree/rock) are
 * built per-instance from a seed (varied lump count/colour/vertex noise) and
 * merged into ONE BufferGeometry so each is a single draw call. Decorative
 * props (bush/flower/grass) return one shared geometry+material for an
 * InstancedMesh (thousands of instances, one draw call each).
 *
 * All materials are CelMaterial({flatShading:true}) — never MeshStandardMaterial,
 * never src/materials/toon.ts (deleted in 001). Multi-colour parts (tree
 * trunk/foliage, flower stem/petal) use the vertexColors path: a per-vertex
 * `color` attribute holds LINEAR rgb (THREE.Color converts sRGB hex -> LINEAR,
 * matching the heightmap convention so props read as the same world as 003).
 *
 * Geometry is authored with its base at y=0; PropField positions it at terrain
 * height and applies the per-instance scale.
 */

/** Palette (sRGB hex; aligned to 003 terrain so props belong to the world). */
const TRUNK_COLOR = 0x6b4f2e;
const FOLIAGE_COLORS = [0x4f7a3a, 0x5b8a42, 0x6aa84f, 0x3f6a32];
const ROCK_COLOR = 0x7d8a96;
const BUSH_COLOR = 0x4f7a3a;
const GRASS_COLORS = [0x5b8a42, 0x6aa84f, 0x4f7a3a];
const STEM_COLOR = 0x4f7a3a;
const PETAL_COLORS = [0xe6e04a, 0xe88a3a, 0xd24a6a, 0xa04ae6, 0xf2f2f2];

export interface BuiltProp {
  geometry: THREE.BufferGeometry;
  material: CelMaterial;
  /** Free the geometry and material this factory allocated. */
  dispose(): void;
}

/** Big prop: per-instance merged geometry (unique by seed). */
export function buildTree(seed: number): BuiltProp {
  return buildOnce(() => buildTreeGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Big prop: per-instance dodecahedron with radial vertex noise. */
export function buildRock(seed: number): BuiltProp {
  return buildOnce(() => buildRockGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Decor: shared squashed icosahedron for an InstancedMesh. */
export function buildBush(): BuiltProp {
  return buildOnce(buildBushGeometry, { color: BUSH_COLOR });
}

/** Decor: shared stem + petal (merged, vertex-coloured) for an InstancedMesh. */
export function buildFlower(): BuiltProp {
  return buildOnce(buildFlowerGeometry, { vertexColors: true });
}

/** Decor: shared crossed blades (merged, vertex-coloured) for an InstancedMesh. */
export function buildGrass(): BuiltProp {
  return buildOnce(buildGrassGeometry, { vertexColors: true });
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function buildOnce(
  makeGeo: () => THREE.BufferGeometry,
  celOpts: { color?: number; vertexColors?: boolean },
): BuiltProp {
  const geometry = makeGeo();
  const material = makeCel({ flatShading: true, ...celOpts });
  return {
    geometry,
    material,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

function buildTreeGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunkH = 4;
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(prepPart(trunk, TRUNK_COLOR));

  const lumps = rng.pick([2, 3, 3, 4]);
  let y = trunkH - 0.4;
  for (let i = 0; i < lumps; i++) {
    const r = rng.range(1.7, 2.7) * (1 - i * 0.12);
    const foliage = new THREE.IcosahedronGeometry(r, 0);
    foliage.translate(rng.range(-0.5, 0.5), y, rng.range(-0.5, 0.5));
    parts.push(prepPart(foliage, rng.pick(FOLIAGE_COLORS)));
    y += r * 0.7;
  }

  return mergeOrFirst(parts);
}

function buildRockGeometry(rng: RNG): THREE.BufferGeometry {
  const r = rng.range(0.9, 1.8);
  const geo = new THREE.DodecahedronGeometry(r, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + rng.unit() * 0.3;
    v.multiplyScalar(d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.translate(0, r * 0.5, 0);
  return prepPart(geo, ROCK_COLOR);
}

function buildBushGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.9, 0);
  geo.scale(1, 0.7, 1);
  geo.translate(0, 0.45, 0);
  return geo;
}

function buildFlowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const stemH = 0.5;
  const stem = new THREE.CylinderGeometry(0.03, 0.04, stemH, 4);
  stem.translate(0, stemH / 2, 0);
  parts.push(prepPart(stem, STEM_COLOR));

  const petal = new THREE.IcosahedronGeometry(0.14, 0);
  petal.translate(0, stemH + 0.05, 0);
  parts.push(prepPart(petal, PETAL_COLORS[0]!));

  return mergeOrFirst(parts);
}

function buildGrassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 0.5;
  const w = 0.08;
  const blades = 3;
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.PlaneGeometry(w, h);
    blade.translate(0, h / 2, 0);
    blade.rotateY((i / blades) * Math.PI);
    parts.push(prepPart(blade, GRASS_COLORS[i % GRASS_COLORS.length]!));
  }
  return mergeOrFirst(parts);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a part for merging: flatten to NON-indexed (Cylinder/Plane are
 * indexed, Ico/Dodeca are not; mergeGeometries needs consistent indexing),
 * drop `uv` (props are untextured), and bake a uniform LINEAR `color`
 * attribute. Returns the part to use (may be a new geometry when de-indexed).
 */
function prepPart(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = geo.index !== null ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute("uv");
  paintColor(g, hex);
  return g;
}

function paintColor(geo: THREE.BufferGeometry, hex: number): void {
  const c = new THREE.Color(hex); // sRGB hex -> LINEAR working space
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

function mergeOrFirst(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0]!;
  const merged = mergeGeometries(parts, false);
  disposeAll(parts);
  if (!merged) throw new Error("propFactory: mergeGeometries returned null");
  return merged;
}

function disposeAll(parts: THREE.BufferGeometry[]): void {
  for (const p of parts) p.dispose();
}
