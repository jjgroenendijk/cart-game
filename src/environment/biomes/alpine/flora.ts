import * as THREE from "three";
import { makeRNG, type RNG } from "../../../core/rng";
import { type BuiltProp, buildOnce, prepPart, ROCK_BURY } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { coniferTree, groundDecor, snagTree } from "../../flora/archetypes";

/**
 * Alpine flora: 6 procedural cel kinds. The mountain forest is now a real
 * mixed conifer stand: towering per-seed alpinePine spires (15-20 m total)
 * over shorter dense firs, punctuated by weathered snags, with scree rocks +
 * lichen + hardy blooms below. alpinePine/fir/alpineSnag are archetype-built;
 * screeRock keeps its bespoke geometry (radius-fn collider parity).
 *
 * Decor builders (lichenBush/alpineBloom) ignore the seed arg (shared
 * template) — `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to alpine terrain grass + granite rock). */
const PINE_FOLIAGE_COLOR = 0x2f4a2a;
const PINE_TRUNK_COLOR = 0x4a3526;
const FIR_FOLIAGE_COLOR = 0x26402a;
const SNAG_COLOR = 0x9a938a;
const SCREE_ROCK_COLOR = 0x8a8a92;
const LICHEN_COLOR = 0x7a8a6a;
const BLOOM_COLORS = [0xf2f2f2, 0xa04ae6, 0x6a8ae6] as const;
const BLOOM_STEM_COLOR = 0x5a7a4a;

// Towering spire: the alpine signature. Per-seed trunk height 11-15 m plus
// tiers puts the total at ~15-20 m so the forest finally matches the massifs.
const alpinePine = coniferTree({
  trunkHRange: [11, 15],
  trunkRadius: 0.65,
  tierCounts: [4, 5],
  tierRadius: 3.6,
  tierH: 4.2,
  foliage: [PINE_FOLIAGE_COLOR],
  trunkColor: PINE_TRUNK_COLOR,
});

// Fir: shorter, denser, darker understorey conifer beneath the spires.
const fir = coniferTree({
  trunkHRange: [6.5, 9],
  trunkRadius: 0.5,
  tierCounts: [5, 6],
  tierRadius: 2.4,
  tierH: 2.6,
  foliage: [FIR_FOLIAGE_COLOR],
  trunkColor: PINE_TRUNK_COLOR,
});

// Weathered grey snag: storm-killed spire on the granite line.
const alpineSnag = snagTree({
  trunkHRange: [6, 9],
  trunkRadius: 0.45,
  limbCounts: [2, 3],
  color: SNAG_COLOR,
});

// Hardy cushion bloom: white/violet dots in the lichen mats.
const alpineBloom = groundDecor({
  mode: "petal",
  h: 0.3,
  count: 2,
  palette: BLOOM_COLORS,
  stemColor: BLOOM_STEM_COLOR,
});

/** Big prop: per-instance towering conifer spire (unique by seed). */
export function buildAlpinePine(seed: number): BuiltProp {
  return alpinePine.build(seed);
}

/** Big prop: per-instance dodecahedron with radial vertex noise. */
export function buildScreeRock(seed: number): BuiltProp {
  return buildOnce(() => buildScreeRockGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
}

/** Decor: shared squashed icosahedron for an InstancedMesh. */
export function buildLichenBush(): BuiltProp {
  return buildOnce(buildLichenBushGeometry, { color: LICHEN_COLOR });
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function buildScreeRockGeometry(rng: RNG): THREE.BufferGeometry {
  // First draw MUST match screeRockRadius so the ball collider tracks the
  // visible bulk (PropField.createBody parity with the temperate/desert rock).
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
  return prepPart(geo, SCREE_ROCK_COLOR);
}

function buildLichenBushGeometry(): THREE.BufferGeometry {
  // Smaller + flatter than the temperate/desert bush; pale greenish-grey
  // lichen read hugging the ground.
  const geo = new THREE.IcosahedronGeometry(0.6, 0);
  geo.scale(1, 0.5, 1);
  geo.translate(0, 0.25, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// registry wiring (pure addition; a later commit selects biome flora)
// ---------------------------------------------------------------------------

/**
 * Base dodeca radius for a screeRock seed. Single source of truth shared by the
 * screeRock visual builder and the Rapier ball collider so the collider tracks
 * the visible rock bulk (PropField.createBody). Deterministic from the first
 * RNG draw, matching buildScreeRockGeometry's `r`.
 */
export function screeRockRadius(seed: number): number {
  return makeRNG(seed).range(0.8, 1.5);
}

/**
 * Cylinder halfHeight 6 + radius 0.95 spans the lower trunk bulk (y 0..12) of
 * the taller per-seed spire (range midpoint 13 m). Slightly wider than the
 * trunk radius on purpose: a slim collision proxy would let karts clip
 * through the foliage base, so a small margin keeps the body readable.
 */
registerFlora("alpinePine", {
  build: buildAlpinePine,
  big: true,
  collider: { shape: "cylinder", halfHeight: 6, radius: 0.95 },
});

registerFlora("fir", fir);

registerFlora("alpineSnag", alpineSnag);

registerFlora("screeRock", {
  build: buildScreeRock,
  big: true,
  collider: { shape: "ball", radius: screeRockRadius, bury: ROCK_BURY },
});

registerFlora("lichenBush", {
  build: buildLichenBush,
  big: false,
  collider: { shape: "none" },
});

registerFlora("alpineBloom", alpineBloom);
