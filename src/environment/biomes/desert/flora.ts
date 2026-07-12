import * as THREE from "three";
import { makeRNG, type RNG } from "../../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart, ROCK_BURY } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, groundDecor, lumpyShrub, snagTree } from "../../flora/archetypes";

/**
 * Desert flora: 8 procedural cel kinds. Bespoke saguaro (cactus) + sandRock +
 * yucca + dryShrub, plus archetype-built mesaRock (big flattened boulder),
 * desertSnag (sun-bleached dead tree), barrelCactus, and desertBloom. The
 * saguaro is per-seed 4.9-7.3 m tall so a scatter reads as individual giants
 * against the dunes instead of cloned posts.
 *
 * Decor builders (yucca/dryShrub/barrelCactus/desertBloom) ignore the seed
 * arg (shared template) — `() => BuiltProp` is assignable to
 * `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to the desert terrain so props belong to it). */
const CACTUS_BODY_COLOR = 0x5b7d3a;
const CACTUS_BASE_COLOR = 0x6b5a3e;
const SAND_ROCK_COLOR = 0xb08d5a;
const MESA_ROCK_COLOR = 0xc09a62;
const SNAG_COLOR = 0xcbb894;
const YUCCA_COLOR = 0x6a7a4a;
const DRY_SHRUB_COLOR = 0x8a6a3a;
const BARREL_CACTUS_COLOR = 0x5b7d3a;
const BLOOM_COLORS = [0xe8944a, 0xd8583a, 0xe6c04a] as const;
const BLOOM_STEM_COLOR = 0x6a7a4a;

// Mesa boulder: a big flattened warm-rock mass anchoring a dune crest.
const mesaRock = ballRock({
  rMin: 1.6,
  rMax: 2.8,
  flatten: 0.7,
  color: MESA_ROCK_COLOR,
});

// Sun-bleached snag: pale storm-broken deadwood between the saguaros.
const desertSnag = snagTree({
  trunkHRange: [4.5, 7],
  trunkRadius: 0.35,
  limbCounts: [2, 3],
  color: SNAG_COLOR,
});

// Barrel cactus: squat green dome hugging the sand.
const barrelCactus = lumpyShrub({
  r: 0.45,
  squashY: 0.9,
  color: BARREL_CACTUS_COLOR,
  yOffset: 0.35,
});

// Desert bloom: rare hot-colour cactus-flower accent.
const desertBloom = groundDecor({
  mode: "petal",
  h: 0.4,
  count: 2,
  palette: BLOOM_COLORS,
  stemColor: BLOOM_STEM_COLOR,
});

/** Big prop: per-instance merged column + arms (unique by seed). */
export function buildCactus(seed: number): BuiltProp {
  return buildOnce(() => buildCactusGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
}

/** Big prop: per-instance dodecahedron with radial vertex noise. */
export function buildSandRock(seed: number): BuiltProp {
  return buildOnce(() => buildSandRockGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
}

/** Decor: shared crossed spike blades (merged, vertex-coloured). */
export function buildYucca(): BuiltProp {
  return buildOnce(buildYuccaGeometry, { vertexColors: true });
}

/** Decor: shared squashed icosahedron for an InstancedMesh. */
export function buildDryShrub(): BuiltProp {
  return buildOnce(buildDryShrubGeometry, { color: DRY_SHRUB_COLOR });
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function buildCactusGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Per-seed column height FIRST: a saguaro scatter carries real height
  // variation (4.9-7.3 m with the base) instead of one cloned post.
  const trunkH = rng.range(4.5, 6.5);

  // Woody base: a slightly wider stub so the cactus reads as rooted.
  const baseH = 0.4;
  const base = new THREE.CylinderGeometry(0.5, 0.6, baseH, 6);
  base.translate(0, baseH / 2, 0);
  parts.push(prepPart(base, CACTUS_BASE_COLOR));

  // Main column (green). Base sits on top of the woody stub.
  const trunk = new THREE.CylinderGeometry(0.38, 0.46, trunkH, 6);
  trunk.translate(0, baseH + trunkH / 2, 0);
  parts.push(prepPart(trunk, CACTUS_BODY_COLOR));

  // Arms: 2 or 3, splayed around the column at varied heights/azimuths so
  // the silhouette carries >=3 lumps and reads as cel at distance. Each arm
  // is a short horizontal connector + an upward branch.
  const arms = rng.pick([2, 2, 3]);
  const offset = 0.55;
  for (let i = 0; i < arms; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const branchY = rng.range(baseH + 1.2, baseH + trunkH - 1.4);

    // Connector: horizontal cylinder from the column out to the arm.
    const stub = new THREE.CylinderGeometry(0.2, 0.22, offset, 6);
    stub.rotateZ(Math.PI / 2);
    stub.translate(offset / 2, branchY, 0);
    stub.rotateY(angle);
    parts.push(prepPart(stub, CACTUS_BODY_COLOR));

    // Upward branch.
    const armH = rng.range(1.6, 2.8);
    const arm = new THREE.CylinderGeometry(0.22, 0.26, armH, 6);
    arm.translate(offset, branchY + armH / 2, 0);
    arm.rotateY(angle);
    parts.push(prepPart(arm, CACTUS_BODY_COLOR));
  }

  return mergeOrFirst(parts);
}

function buildSandRockGeometry(rng: RNG): THREE.BufferGeometry {
  // First draw MUST match sandRockRadius so the ball collider tracks the
  // visible bulk (PropField.createBody parity with the temperate rock).
  const r = rng.range(0.8, 1.5);
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
  return prepPart(geo, SAND_ROCK_COLOR);
}

function buildYuccaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const h = 1.1;
  const blades = 4;
  // Alternating lean per blade so the bundle reads as splayed, not flat.
  // Deterministic (no RNG): the decor template is shared across instances.
  const tilts = [0.18, -0.18, 0.18, -0.18];
  for (let i = 0; i < blades; i++) {
    // Tall thin cone: tapers to a point like a yucca spike blade.
    const blade = new THREE.ConeGeometry(0.06, h, 4);
    blade.translate(0, h / 2, 0);
    blade.rotateY((i / blades) * Math.PI);
    blade.rotateZ(tilts[i]!);
    parts.push(prepPart(blade, YUCCA_COLOR));
  }
  return mergeOrFirst(parts);
}

function buildDryShrubGeometry(): THREE.BufferGeometry {
  // Smaller + flatter than the temperate bush; tan/dry read.
  const geo = new THREE.IcosahedronGeometry(0.6, 0);
  geo.scale(1, 0.6, 1);
  geo.translate(0, 0.3, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// registry wiring (pure addition; commit 5 selects biome flora by region)
// ---------------------------------------------------------------------------

/**
 * Base dodeca radius for a sandRock seed. Single source of truth shared by the
 * sandRock visual builder and the Rapier ball collider so the collider tracks
 * the visible rock bulk (PropField.createBody). Deterministic from the first
 * RNG draw, matching buildSandRockGeometry's `r`.
 */
export function sandRockRadius(seed: number): number {
  return makeRNG(seed).range(0.8, 1.5);
}

registerFlora("cactus", {
  build: buildCactus,
  big: true,
  // Spans the lower column bulk of the taller per-seed saguaro (y 0..5.6).
  collider: { shape: "cylinder", halfHeight: 2.8, radius: 0.55 },
});

registerFlora("mesaRock", mesaRock);

registerFlora("desertSnag", desertSnag);

registerFlora("sandRock", {
  build: buildSandRock,
  big: true,
  collider: { shape: "ball", radius: sandRockRadius, bury: ROCK_BURY },
});

registerFlora("yucca", {
  build: buildYucca,
  big: false,
  collider: { shape: "none" },
});

registerFlora("dryShrub", {
  build: buildDryShrub,
  big: false,
  collider: { shape: "none" },
});

registerFlora("barrelCactus", barrelCactus);

registerFlora("desertBloom", desertBloom);
