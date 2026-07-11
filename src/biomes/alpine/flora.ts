import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import {
  type BuiltProp,
  buildOnce,
  mergeOrFirst,
  prepPart,
  ROCK_BURY,
} from "../../environment/propFactory";
import { registerFlora } from "../../environment/floraRegistry";

/**
 * Alpine flora: 3 procedural cel kinds (alpinePine/screeRock/lichenBush) for
 * backlog 028 commit 1. Pure addition — nothing references these kinds yet;
 * registering at module load wires them into the flora registry so a later
 * commit resolves them by kind name from an Alpine biome selector. Builders,
 * palettes, and geometry fns mirror the temperate + desert modules.
 *
 * Decor builder (lichenBush) ignores the seed arg (shared template) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to alpine terrain grass + granite rock). */
const PINE_FOLIAGE_COLOR = 0x2f4a2a;
const PINE_TRUNK_COLOR = 0x4a3526;
const SCREE_ROCK_COLOR = 0x8a8a92;
const LICHEN_COLOR = 0x7a8a6a;

/** Big prop: per-instance merged trunk + stacked cone tiers (unique by seed). */
export function buildAlpinePine(seed: number): BuiltProp {
  return buildOnce(() => buildAlpinePineGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
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

function buildAlpinePineGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Thick tall trunk: a towering spire silhouette alpine pines read as at
  // altitude, scaled up for a dense-mountain-forest mood.
  const trunkH = 8.0;
  const trunk = new THREE.CylinderGeometry(0.4, 0.55, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(prepPart(trunk, PINE_TRUNK_COLOR));

  // Stacked conical foliage tiers tapering upward (a fir/spruce spire):
  // each tier's base overlaps the next so the silhouette carries >=3 lumps
  // and reads as cel at distance. Cones shrink per tier toward the tip.
  const tiers = rng.pick([4, 5]);
  let baseY = trunkH - 2.5;
  for (let i = 0; i < tiers; i++) {
    const r = 2.6 * (1 - i * 0.16);
    const h = 3.4;
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, baseY + h / 2, 0);
    parts.push(prepPart(cone, PINE_FOLIAGE_COLOR));
    baseY += h * 0.5;
  }

  return mergeOrFirst(parts);
}

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
 * Cylinder halfHeight 4 + radius 0.8 spans the lower trunk bulk (y 0..8),
 * matching the tall spire trunk the geometry authors. Slightly wider than the
 * trunk radius (0.4-0.55) on purpose: a slim collision proxy would let karts
 * clip through the foliage base, so a small margin keeps the body readable.
 */
registerFlora("alpinePine", {
  build: buildAlpinePine,
  big: true,
  collider: { shape: "cylinder", halfHeight: 4, radius: 0.8 },
});

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
