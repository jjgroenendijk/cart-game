import * as THREE from "three";
import { makeRNG } from "../../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, branchingTree, canopyTree, groundDecor } from "../../flora/archetypes";

/**
 * Autumn-forest flora (cel, low-poly): an enchanted fairy-tale wood at the
 * turn of the season. A dense golden/red canopy — broadleaf autumnTree +
 * limbed autumnOak (big) over mossy mossRock — with a busy forest floor of
 * bespoke toadstool mushrooms, muted ferns, and leaf-litter tufts. Big-prop
 * sum 8 (at cap).
 *
 * canopyTree/branchingTree pick each foliage lump color via rng.pick(foliage),
 * so a multi-color orange/red/gold palette yields per-instance AND per-lump
 * autumn variation for free — no two trees share a crown.
 *
 * autumnTree/autumnOak/mossRock are archetype configs; mushroom is bespoke
 * (buildOnce + mergeOrFirst + prepPart). Decor builders ignore the seed arg
 * (shared template for an InstancedMesh) — `() => BuiltProp` is assignable to
 * `(seed: number) => BuiltProp`. mossRockRadius delegates to the ballRock
 * radius fn so the visual + Rapier ball collider share the first RNG draw.
 */

// Warm turning-leaf palette (sRGB hex). Foliage stays saturated orange/red/
// gold for the enchanted canopy; trunks + floor read as damp mossy woodland.
const AUTUMN_FOLIAGE_COLORS = [0xd2691e, 0xb03a2a, 0xe0a83a] as const;
const AUTUMN_TRUNK_COLOR = 0x5a4432;
const OAK_TRUNK_COLOR = 0x574030;
const MOSS_ROCK_COLOR = 0x6a7a4a;
const FERN_COLORS = [0x5e7a3a, 0x6e8a44, 0x4f6a34] as const;
const LEAF_LITTER_COLORS = [0xc07a2a, 0xa8482a, 0xcf9a3a] as const;
const MUSHROOM_STEM_COLOR = 0xe4d8c0;
const MUSHROOM_CAP_COLORS = [0xb0301f, 0xc85a2a, 0x8a4a2a] as const;

// Autumn broadleaf: a full multi-lobe crown of turning leaves on a per-seed
// 5-7 m trunk. rng.pick over the 3-colour palette paints each lump, so a stand
// mixes orange/red/gold both across trees and within one crown.
const autumnTree = canopyTree({
  trunkHRange: [5, 7],
  trunkRadius: 0.62,
  lobeCounts: [3, 4, 4, 5],
  canopyR: 2.7,
  foliage: AUTUMN_FOLIAGE_COLORS,
  trunkColor: AUTUMN_TRUNK_COLOR,
  jitter: 0.7,
});

// Autumn oak: the characterful limbed giant anchoring the canopy depth —
// visible branches each carrying a foliage mass under a wide crown, per-seed
// 7-10 m trunk, same warm palette.
const autumnOak = branchingTree({
  trunkHRange: [7, 10],
  trunkRadius: 0.78,
  limbCounts: [3, 3, 4],
  limbLen: 2.8,
  canopyR: 3.4,
  crownCounts: [3, 4],
  foliage: AUTUMN_FOLIAGE_COLORS,
  trunkColor: OAK_TRUNK_COLOR,
});

// Moss rock: a big moss-greened boulder on the forest floor.
const mossRock = ballRock({
  rMin: 1.0,
  rMax: 1.9,
  color: MOSS_ROCK_COLOR,
});

// Fern: muted green fronds fanning across the shaded floor.
const fern = groundDecor({
  mode: "blade",
  h: 0.75,
  w: 0.4,
  count: 5,
  palette: FERN_COLORS,
});

// Leaf litter: low tufts of fallen leaves scattered over the moss.
const leafLitter = groundDecor({
  mode: "blade",
  h: 0.28,
  w: 0.22,
  count: 4,
  palette: LEAF_LITTER_COLORS,
});

/** Big prop: per-seed golden/red broadleaf crown on a bare trunk. */
export function buildAutumnTree(seed: number): BuiltProp {
  return autumnTree.build(seed);
}

/** Big prop: per-seed limbed oak with a wide multi-lump autumn crown. */
export function buildAutumnOak(seed: number): BuiltProp {
  return autumnOak.build(seed);
}

/** Big prop: per-instance noisy dodecahedron moss boulder. */
export function buildMossRock(seed: number): BuiltProp {
  return mossRock.build(seed);
}

/** Decor: bespoke toadstool clump — stems + domed caps (seed ignored). */
export function buildMushroom(): BuiltProp {
  return buildOnce(buildMushroomGeometry, { vertexColors: true });
}

/** Decor: shared fanning fern clump (seed ignored). */
export function buildFern(): BuiltProp {
  return fern.build(0);
}

/** Decor: shared low leaf-litter tuft (seed ignored). */
export function buildLeafLitter(): BuiltProp {
  return leafLitter.build(0);
}

// ---------------------------------------------------------------------------
// bespoke geometry
// ---------------------------------------------------------------------------

/**
 * Toadstool clump: 3 mushrooms of differing height + cap size, each a slim
 * pale stem cylinder topped by a squashed-icosahedron dome cap (red/brown),
 * offset around the base so the cluster reads as a fairy-ring patch rather
 * than a single stalk. Fixed (no seed) — an InstancedMesh shares this template.
 */
function buildMushroomGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shrooms = 3;
  // Per-mushroom height, cap radius, and floor offset (fixed constants keep the
  // template deterministic without a seed draw).
  const stemH = [0.34, 0.24, 0.42];
  const capR = [0.2, 0.15, 0.24];
  const offX = [0, 0.24, -0.2];
  const offZ = [0, -0.18, 0.22];
  for (let i = 0; i < shrooms; i++) {
    const h = stemH[i]!;
    const stem = new THREE.CylinderGeometry(0.045, 0.06, h, 5);
    stem.translate(offX[i]!, h / 2, offZ[i]!);
    parts.push(prepPart(stem, MUSHROOM_STEM_COLOR));
    // Cap: a low dome (squashed ico) seated on the stem top.
    const cap = new THREE.IcosahedronGeometry(capR[i]!, 0);
    cap.scale(1, 0.6, 1);
    cap.translate(offX[i]!, h + capR[i]! * 0.35, offZ[i]!);
    parts.push(prepPart(cap, MUSHROOM_CAP_COLORS[i % MUSHROOM_CAP_COLORS.length]!));
  }
  return mergeOrFirst(parts);
}

// ballRock always yields a ball collider exposing the radius fn that draws the
// same first RNG value as the visual; delegate so mossRockRadius tracks the
// archetype's rMin/rMax knob and stays the single source of truth.
const mossRockRadiusOf =
  mossRock.collider.shape === "ball"
    ? mossRock.collider.radius
    : (seed: number): number => makeRNG(seed).range(1.0, 1.9);

/**
 * Base dodeca radius for a mossRock seed. Delegates to the ballRock archetype's
 * radius fn so the visual + Rapier ball collider share the first RNG draw
 * (PropField.createBody parity). Stable:
 * mossRockRadius(s) == makeRNG(s).range(1.0, 1.9).
 */
export function mossRockRadius(seed: number): number {
  return mossRockRadiusOf(seed);
}

// ---------------------------------------------------------------------------
// registry wiring (the autumn biome selects these kinds)
// ---------------------------------------------------------------------------

registerFlora("autumnTree", autumnTree);

registerFlora("autumnOak", autumnOak);

registerFlora("mossRock", mossRock);

registerFlora("mushroom", {
  build: buildMushroom,
  big: false,
  collider: { shape: "none" },
});

registerFlora("fern", fern);

registerFlora("leafLitter", leafLitter);
