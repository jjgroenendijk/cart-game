import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart, ROCK_BURY } from "../propFactory";
import { registerFlora } from "../floraRegistry";

/**
 * Tundra flora: 3 procedural cel kinds (pine/iceRock/snowBush) for backlog 027
 * commit 1. Pure addition — nothing references these kinds yet; registering at
 * module load wires them into the flora registry so a later commit resolves
 * them by kind name from a Tundra biome selector. Builders, palettes, and
 * geometry fns mirror the alpine + desert modules.
 *
 * Decor builder (snowBush) ignores the seed arg (shared template) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; cold/icy read aligned to a pale tundra terrain). */
const PINE_FOLIAGE_COLOR = 0x5a7868;
const PINE_SNOW_CAP_COLOR = 0xeaf0f3;
const PINE_TRUNK_COLOR = 0x4a3d34;
const ICE_ROCK_COLOR = 0xb0c8d4;
const SNOW_BUSH_COLOR = 0xd8dde0;

/** Big prop: per-instance merged trunk + stacked cone tiers (unique by seed). */
export function buildPine(seed: number): BuiltProp {
  return buildOnce(() => buildPineGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Big prop: per-instance dodecahedron with radial vertex noise. */
export function buildIceRock(seed: number): BuiltProp {
  return buildOnce(() => buildIceRockGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Decor: shared squashed icosahedron for an InstancedMesh. */
export function buildSnowBush(): BuiltProp {
  return buildOnce(buildSnowBushGeometry, { color: SNOW_BUSH_COLOR });
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function buildPineGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Short stocky trunk: a snow-laden tundra pine reads as a compact, rounded
  // dome rather than alpine's tall dark spire — scaled shorter + stouter so
  // the silhouette is distinct at a glance.
  const trunkH = 5.0;
  const trunk = new THREE.CylinderGeometry(0.45, 0.6, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(prepPart(trunk, PINE_TRUNK_COLOR));

  // Stacked conical foliage tiers tapering upward: fewer tiers + broader
  // bases than alpine so the crown reads as a wide snow-dome. The topmost
  // tier is painted with the pale snow-cap colour so it reads as snow-laden.
  const tiers = rng.pick([3, 4]);
  let baseY = trunkH - 1.5;
  for (let i = 0; i < tiers; i++) {
    const r = 3.2 * (1 - i * 0.14);
    const h = 2.8;
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, baseY + h / 2, 0);
    const color = i === tiers - 1 ? PINE_SNOW_CAP_COLOR : PINE_FOLIAGE_COLOR;
    parts.push(prepPart(cone, color));
    baseY += h * 0.5;
  }

  return mergeOrFirst(parts);
}

function buildIceRockGeometry(rng: RNG): THREE.BufferGeometry {
  // First draw MUST match iceRockRadius so the ball collider tracks the
  // visible bulk (PropField.createBody parity with the alpine/desert rock).
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
  return prepPart(geo, ICE_ROCK_COLOR);
}

function buildSnowBushGeometry(): THREE.BufferGeometry {
  // Low pale dome hugging the snow; squashed flat so it reads as a drift-
  // settled bush rather than a temperate clump.
  const geo = new THREE.IcosahedronGeometry(0.6, 0);
  geo.scale(1, 0.45, 1);
  geo.translate(0, 0.25, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// registry wiring (pure addition; a later commit selects biome flora)
// ---------------------------------------------------------------------------

/**
 * Base dodeca radius for an iceRock seed. Single source of truth shared by the
 * iceRock visual builder and the Rapier ball collider so the collider tracks
 * the visible rock bulk (PropField.createBody). Deterministic from the first
 * RNG draw, matching buildIceRockGeometry's `r`.
 */
export function iceRockRadius(seed: number): number {
  return makeRNG(seed).range(0.8, 1.5);
}

/**
 * Cylinder halfHeight 2.5 + radius 0.8 spans the lower trunk bulk (y 0..5),
 * matching the stocky trunk the geometry authors. Slightly wider than the
 * trunk radius (0.45-0.6) on purpose: a slim collision proxy would let karts
 * clip through the foliage base, so a small margin keeps the body readable.
 */
registerFlora("pine", {
  build: buildPine,
  big: true,
  collider: { shape: "cylinder", halfHeight: 2.5, radius: 0.8 },
});

registerFlora("iceRock", {
  build: buildIceRock,
  big: true,
  collider: { shape: "ball", radius: iceRockRadius, bury: ROCK_BURY },
});

registerFlora("snowBush", {
  build: buildSnowBush,
  big: false,
  collider: { shape: "none" },
});
