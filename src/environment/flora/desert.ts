import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart, ROCK_BURY } from "../propFactory";
import { registerFlora } from "../floraRegistry";

/**
 * Desert flora: 4 procedural cel kinds (cactus/sandRock/yucca/dryShrub) for
 * backlog 026 commit 1. Pure addition — nothing references these kinds yet;
 * registering at module load wires them into the flora registry so a later
 * commit resolves them by kind name from a Desert biome selector. Builders,
 * palettes, and geometry fns mirror the temperate module's conventions.
 *
 * Decor builders (yucca/dryShrub) ignore the seed arg (shared template) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to the desert terrain so props belong to it). */
const CACTUS_BODY_COLOR = 0x5b7d3a;
const CACTUS_BASE_COLOR = 0x6b5a3e;
const SAND_ROCK_COLOR = 0xb08d5a;
const YUCCA_COLOR = 0x6a7a4a;
const DRY_SHRUB_COLOR = 0x8a6a3a;

/** Big prop: per-instance merged column + arms (unique by seed). */
export function buildCactus(seed: number): BuiltProp {
  return buildOnce(() => buildCactusGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Big prop: per-instance dodecahedron with radial vertex noise. */
export function buildSandRock(seed: number): BuiltProp {
  return buildOnce(() => buildSandRockGeometry(makeRNG(seed)), { vertexColors: true });
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

  // Woody base: a slightly wider stub so the cactus reads as rooted.
  const baseH = 0.4;
  const base = new THREE.CylinderGeometry(0.42, 0.5, baseH, 6);
  base.translate(0, baseH / 2, 0);
  parts.push(prepPart(base, CACTUS_BASE_COLOR));

  // Main column (green). Base sits on top of the woody stub.
  const trunkH = 3.6;
  const trunk = new THREE.CylinderGeometry(0.32, 0.38, trunkH, 6);
  trunk.translate(0, baseH + trunkH / 2, 0);
  parts.push(prepPart(trunk, CACTUS_BODY_COLOR));

  // Arms: 1 or 2, splayed around the column at varied heights/azimuths so
  // the silhouette carries >=2 lumps and reads as cel at distance. Each arm
  // is a short horizontal connector + an upward branch.
  const arms = rng.pick([1, 2]);
  const offset = 0.45;
  for (let i = 0; i < arms; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const branchY = rng.range(baseH + 0.8, baseH + trunkH - 1.0);

    // Connector: horizontal cylinder from the column out to the arm.
    const stub = new THREE.CylinderGeometry(0.18, 0.2, offset, 6);
    stub.rotateZ(Math.PI / 2);
    stub.translate(offset / 2, branchY, 0);
    stub.rotateY(angle);
    parts.push(prepPart(stub, CACTUS_BODY_COLOR));

    // Upward branch.
    const armH = rng.range(1.2, 2.0);
    const arm = new THREE.CylinderGeometry(0.2, 0.24, armH, 6);
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
  collider: { shape: "cylinder", halfHeight: 2.0, radius: 0.5 },
});

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
