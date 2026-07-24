import * as THREE from "three";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, canopyTree, coniferTree, groundDecor } from "../../flora/archetypes";

/**
 * Mediterranean / Golden-Hills flora: 5 kinds for the sunlit vineyard country.
 * cypress + poplar + oliveRock are big props with colliders; vineRow +
 * lavender are decor (no collider). Only vineRow is bespoke (buildOnce +
 * mergeOrFirst + prepPart) — the rest are archetype configs. Pigments sit in
 * the warm-dry register: dark cypress green and dusty olive foliage over
 * golden grass, weathered vine wood, sun-bleached limestone.
 *
 * vineRow answers the placement question the biome poses: the row read lives
 * in the PROP (a short trellis segment: stakes + a trained vine hedge), not in
 * the sampler, so the shipped jittered-grid sampler places vineyard rows with
 * no new row-placement machinery.
 *
 * All geometry is authored base-at-y=0 (PropField places the origin at terrain
 * height), deterministic from seed, WebGL-free (jsdom-testable). Decor builders
 * ignore the seed arg (shared template for an InstancedMesh) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

// Golden-hills palette (sRGB hex). Cypress holds the one deep green so the
// spires read against the golden grass; poplar and olive stone stay dusty and
// sun-bleached. Natural pigment only (no neon).
const CYPRESS_FOLIAGE = [0x2f4a34, 0x36523a] as const; // deep cypress green
const CYPRESS_TRUNK_COLOR = 0x5a4632; // dry grey-brown bark
const POPLAR_FOLIAGE = [0x8aa053, 0x94a95e, 0x7f9a4c] as const; // warm yellow-green
const POPLAR_TRUNK_COLOR = 0x9a8f76; // pale grey poplar bark
const OLIVE_ROCK_COLOR = 0xa2977c; // sun-bleached limestone
const VINE_POST_COLOR = 0x7a6244; // weathered vine-stake wood
const VINE_LEAF_COLOR = 0x6f8a48; // dusty vine leaf
const LAVENDER_COLORS = [0x8f7fb8, 0x7a6aa8, 0x8d9478, 0x9aa085] as const; // violet + grey-green

// Vine row: one trained vine hedge on a 3-stake trellis, ~2.6 m along +X.
const VINE_ROW_SPAN = 2.6;
const VINE_POST_H = 0.9;

// Cypress: a tall narrow spire — thin trunk, slim tiers stacked high. The one
// vertical accent of the golden hills. big=true, cylinder collider (coniferTree).
const cypress = coniferTree({
  trunkHRange: [6, 9],
  trunkRadius: 0.28,
  tierCounts: [4, 5],
  tierRadius: 1.05,
  tierH: 3.4,
  foliage: CYPRESS_FOLIAGE,
  trunkColor: CYPRESS_TRUNK_COLOR,
});

// Poplar: tall pale-barked column — a tight, barely-jittered stack of small
// lumps so the crown stays narrow instead of spreading like a temperate tree.
// big=true, cylinder collider (canopyTree).
const poplar = canopyTree({
  trunkHRange: [8, 11],
  trunkRadius: 0.3,
  lobeCounts: [4, 5],
  canopyR: 1.45,
  jitter: 0.22,
  foliage: POPLAR_FOLIAGE,
  trunkColor: POPLAR_TRUNK_COLOR,
});

// Olive rock: a low sun-bleached limestone boulder of the kind olive terraces
// are built around. big=true, ball collider tracking the visual radius (ballRock).
const oliveRock = ballRock({
  rMin: 1,
  rMax: 1.9,
  flatten: 0.75,
  color: OLIVE_ROCK_COLOR,
});

// Lavender: crossed blades alternating violet spike and grey-green foliage
// (palette cycles by blade index). Decor (big=false), no collider.
const lavender = groundDecor({
  mode: "blade",
  h: 0.55,
  w: 0.07,
  count: 4,
  palette: LAVENDER_COLORS,
});

/** Big prop: tall narrow cypress spire. */
export function buildCypress(seed: number): BuiltProp {
  return cypress.build(seed);
}

/** Big prop: tall pale columnar poplar. */
export function buildPoplar(seed: number): BuiltProp {
  return poplar.build(seed);
}

/** Big prop: low sun-bleached limestone boulder. */
export function buildOliveRock(seed: number): BuiltProp {
  return oliveRock.build(seed);
}

/** Decor: shared trellis vine-row segment (seed ignored). */
export function buildVineRow(): BuiltProp {
  return buildOnce(buildVineRowGeometry, { vertexColors: true });
}

/** Decor: shared lavender tuft (seed ignored). */
export function buildLavender(): BuiltProp {
  return lavender.build(0);
}

// ---------------------------------------------------------------------------
// bespoke geometry
// ---------------------------------------------------------------------------

/**
 * Vine row: three weathered stakes carrying one trained vine hedge, laid out
 * along +X so a placed instance reads as a short length of vineyard row
 * (per-instance yaw scatters the row headings). Shared decor template — no
 * RNG, so every instance is the same geometry.
 */
function buildVineRowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = VINE_ROW_SPAN / 2;

  // End + middle posts: short open-ended stakes grounded at y=0 (8 tris each —
  // decor stays inside the <= 60-tri budget the archetype library pins).
  for (const x of [-half, 0, half]) {
    const post = new THREE.CylinderGeometry(0.05, 0.06, VINE_POST_H, 4, 1, true);
    post.translate(x, VINE_POST_H / 2, 0);
    parts.push(prepPart(post, VINE_POST_COLOR));
  }

  // Trained vines: ONE lump stretched along the row into a continuous leafy
  // hedge (20 tris). Separate clumps read as floating blobs at kart speed; a
  // single stretched mass reads as a trained vine row.
  const hedge = new THREE.IcosahedronGeometry(0.42, 0);
  hedge.scale(VINE_ROW_SPAN / 0.84, 0.72, 0.5);
  hedge.translate(0, 0.42, 0);
  parts.push(prepPart(hedge, VINE_LEAF_COLOR));

  return mergeOrFirst(parts);
}

// ---------------------------------------------------------------------------
// registry wiring (side-effect at module load; the mediterranean biome selects these)
// ---------------------------------------------------------------------------

registerFlora("cypress", {
  ...cypress,
  // Cluster: cypresses grow in short avenues/groups (up to 3 within 5 m)
  // rather than an even scatter, mirroring the beach palm contract.
  cluster: { radius: 5, perCluster: 3 },
});

registerFlora("poplar", poplar);

registerFlora("oliveRock", oliveRock);

registerFlora("vineRow", {
  build: buildVineRow,
  big: false,
  collider: { shape: "none" },
});

registerFlora("lavender", lavender);
