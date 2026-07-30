import * as THREE from "three";
import { makeRNG, type RNG } from "../../../core/rng";
import {
  type BuiltProp,
  buildOnce,
  mergeOrFirst,
  prepPart,
  rockRadius,
  ROCK_BURY,
} from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { branchingTree, canopyTree, coniferTree, groundDecor } from "../../flora/archetypes";

/**
 * Temperate flora: a mixed painted woodland (8 kinds) instead of the original
 * single-tree meadow. Big kinds are archetype-built with per-seed heights so
 * a stand reads as individual trees, not clones:
 *
 *   tree       -> branchingTree: big oak, visible limbs, wide crown (~10-13 m)
 *   birch      -> canopyTree: slim pale trunk, small light canopy (~9-12 m)
 *   forestPine -> coniferTree: tall spire breaking the broadleaf line (~13-17 m)
 *   rock       -> bespoke noisy dodeca (rockRadius/ROCK_BURY collider parity)
 *
 * Decor (bush/flower/grass kept, tallGrass added) stays cheap shared-template
 * InstancedMesh geometry. Decor builders ignore the seed arg —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to terrain so props belong to the world). */
const TRUNK_COLOR = 0x6b4f2e;
const FOLIAGE_COLORS = [0x4f7a3a, 0x5b8a42, 0x6aa84f, 0x3f6a32];
const BIRCH_TRUNK_COLOR = 0xd8d4c4;
const BIRCH_FOLIAGE_COLORS = [0x6aa84f, 0x7ab557, 0x5b8a42];
const PINE_FOLIAGE_COLORS = [0x3f6a32, 0x2f4a2a];
const ROCK_COLOR = 0x7d8a96;
const BUSH_COLOR = 0x4f7a3a;
const GRASS_COLORS = [0x5b8a42, 0x6aa84f, 0x4f7a3a];
const TALL_GRASS_COLORS = [0x8a9a4a, 0x6aa84f, 0x7a8a42];
const STEM_COLOR = 0x4f7a3a;
const PETAL_COLORS = [0xe6e04a, 0xe88a3a, 0xd24a6a, 0xa04ae6, 0xf2f2f2];

// Big oak: visible limbs + wide crown carry the painted-woodland read; the
// per-seed height range makes neighbouring oaks genuinely different trees.
const oak = branchingTree({
  trunkHRange: [6.5, 9],
  trunkRadius: 0.8,
  limbCounts: [2, 3, 3],
  limbLen: 3.0,
  canopyR: 3.6,
  crownCounts: [3, 4],
  foliage: FOLIAGE_COLORS,
  trunkColor: TRUNK_COLOR,
});

// Birch: slim pale trunk + small bright canopy; contrast against the oaks.
const birch = canopyTree({
  trunkHRange: [7, 9.5],
  trunkRadius: 0.38,
  lobeCounts: [2, 3, 3],
  canopyR: 2.2,
  foliage: BIRCH_FOLIAGE_COLORS,
  trunkColor: BIRCH_TRUNK_COLOR,
  jitter: 0.4,
});

// Forest pine: a dark spire breaking the broadleaf canopy line.
const forestPine = coniferTree({
  trunkHRange: [10, 13],
  trunkRadius: 0.55,
  tierCounts: [4, 5],
  tierRadius: 3.0,
  tierH: 3.6,
  foliage: PINE_FOLIAGE_COLORS,
  trunkColor: TRUNK_COLOR,
});

// Tall meadow grass: knee-high straw-green tufts between the flowers.
const tallGrass = groundDecor({
  mode: "blade",
  h: 0.9,
  count: 4,
  palette: TALL_GRASS_COLORS,
});

/** Big prop: per-instance branching oak (unique by seed). */
export function buildTree(seed: number): BuiltProp {
  return oak.build(seed);
}

/** Big prop: per-instance slim pale birch (unique by seed). */
export function buildBirch(seed: number): BuiltProp {
  return birch.build(seed);
}

/** Big prop: per-instance dark pine spire (unique by seed). */
export function buildForestPine(seed: number): BuiltProp {
  return forestPine.build(seed);
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

/** Decor: shared knee-high straw tufts (merged, vertex-coloured). */
export function buildTallGrass(): BuiltProp {
  return tallGrass.build(0);
}

// ---------------------------------------------------------------------------
// bespoke geometry (rock + decor templates)
// ---------------------------------------------------------------------------

function buildRockGeometry(rng: RNG): THREE.BufferGeometry {
  const r = rng.range(0.9, 1.8);
  const geo = new THREE.DodecahedronGeometry(r, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  // DodecahedronGeometry is non-indexed: each triangle owns 3 fresh verts,
  // so the ~20 spatial corners are duplicated ~3x. A per-entry RNG scale
  // would tear coincident verts apart -> gaps between every face. Displace by
  // a scale keyed on the quantized base position so shared corners land
  // together and the mesh stays a single closed surface.
  const scaleByKey = new Map<number, number>();
  const keyOf = (x: number, y: number, z: number): number =>
    (Math.round(x * 1e4) * 73856093) ^
    (Math.round(y * 1e4) * 19349663) ^
    (Math.round(z * 1e4) * 83492791);

  const v = new THREE.Vector3();
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = keyOf(v.x, v.y, v.z);
    let d = scaleByKey.get(k);
    if (d === undefined) {
      d = 1 + rng.unit() * 0.3;
      scaleByKey.set(k, d);
    }
    v.multiplyScalar(d);
    pos.setXYZ(i, v.x, v.y, v.z);
    if (v.y < minY) minY = v.y;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  // Author the base below y=0 by ROCK_BURY*r: the lowest displaced corner
  // would otherwise balance the rock on a single point. PropField places the
  // origin at terrain height, so sinking embeds the lower faces into the
  // ground. Track the displaced min Y so the offset is exact.
  geo.translate(0, -minY - r * ROCK_BURY, 0);
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
// registry wiring (Environment resolves the selected biome's kinds by name)
// ---------------------------------------------------------------------------

registerFlora("tree", oak);

registerFlora("birch", birch);

registerFlora("forestPine", forestPine);

registerFlora("rock", {
  build: buildRock,
  big: true,
  collider: { shape: "ball", radius: rockRadius, bury: ROCK_BURY },
  flatShading: true,
});

registerFlora("bush", {
  build: buildBush,
  big: false,
  collider: { shape: "none" },
});

registerFlora("flower", {
  build: buildFlower,
  big: false,
  collider: { shape: "none" },
});

registerFlora("grass", {
  build: buildGrass,
  big: false,
  collider: { shape: "none" },
});

registerFlora("tallGrass", tallGrass);
