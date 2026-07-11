import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import {
  type BuiltProp,
  buildOnce,
  mergeOrFirst,
  prepPart,
  rockRadius,
  ROCK_BURY,
} from "../../environment/propFactory";
import { registerFlora } from "../../environment/floraRegistry";

/**
 * Temperate flora: the 5 pre-biome kinds (tree/rock/bush/flower/grass) moved
 * verbatim from propFactory. Builders, palettes, and geometry fns are
 * byte-identical to the pre-refactor versions (same makeRNG seeds, same
 * palette, same construction). Registering at module load wires them into the
 * flora registry so PropField/propSampler resolve them by kind name.
 *
 * Decor builders (bush/flower/grass) ignore the seed arg (shared template) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to terrain so props belong to the world). */
const TRUNK_COLOR = 0x6b4f2e;
const FOLIAGE_COLORS = [0x4f7a3a, 0x5b8a42, 0x6aa84f, 0x3f6a32];
const ROCK_COLOR = 0x7d8a96;
const BUSH_COLOR = 0x4f7a3a;
const GRASS_COLORS = [0x5b8a42, 0x6aa84f, 0x4f7a3a];
const STEM_COLOR = 0x4f7a3a;
const PETAL_COLORS = [0xe6e04a, 0xe88a3a, 0xd24a6a, 0xa04ae6, 0xf2f2f2];

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
// geometry
// ---------------------------------------------------------------------------

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
// registry wiring (parity hook; commit 5 generalizes to the selected biome)
// ---------------------------------------------------------------------------

registerFlora("tree", {
  build: buildTree,
  big: true,
  collider: { shape: "cylinder", halfHeight: 1.5, radius: 0.6 },
});

registerFlora("rock", {
  build: buildRock,
  big: true,
  collider: { shape: "ball", radius: rockRadius, bury: ROCK_BURY },
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
