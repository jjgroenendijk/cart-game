import { makeRNG } from "../../../core/rng";
import { type BuiltProp } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, coniferTree, lumpyShrub } from "../../flora/archetypes";

/**
 * Tundra flora: 3 cel kinds (pine/iceRock/snowBush) for backlog 027,
 * rebuilt on the parameterized archetypes (backlog 055 commit 2). This
 * module is the migration proof that the archetype kit reproduces a
 * shipped biome: kind names, big flags, collider contracts, and
 * iceRockRadius determinism are unchanged from the bespoke version.
 *
 * iceRock + snowBush are byte-identical to the bespoke builders (ballRock
 * + lumpyShrub factor their exact geometry). pine matches the bespoke
 * silhouette as closely as the archetype knobs allow; the per-tier shrink
 * (0.15 vs bespoke 0.14), trunk taper (0.8 vs 0.75), and first-tier baseY
 * (trunkH - tierH*0.5 vs trunkH - 1.5) are hardcoded in coniferTree, so
 * they carry the archetype defaults. The pine collider is pinned to the
 * tundra contract (halfHeight 2.5 + radius 0.8) rather than the archetype's
 * trunkH/trunkRadius-derived heuristic.
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

// Knobs tuned to the bespoke tundra silhouette (commit 1 archetypes).
const pine = coniferTree({
  trunkH: 5,
  trunkRadius: 0.6,
  tierCounts: [3, 4],
  tierRadius: 3.2,
  tierH: 2.8,
  foliage: [PINE_FOLIAGE_COLOR],
  trunkColor: PINE_TRUNK_COLOR,
  capColor: PINE_SNOW_CAP_COLOR,
});

const iceRock = ballRock({
  rMin: 0.8,
  rMax: 1.5,
  color: ICE_ROCK_COLOR,
});

const snowBush = lumpyShrub({
  r: 0.6,
  squashY: 0.45,
  color: SNOW_BUSH_COLOR,
  yOffset: 0.25,
});

/** Big prop: stocky trunk + stacked snow-capped cone tiers (per-seed). */
export function buildPine(seed: number): BuiltProp {
  return pine.build(seed);
}

/** Big prop: per-instance noisy dodecahedron ice rock. */
export function buildIceRock(seed: number): BuiltProp {
  return iceRock.build(seed);
}

/** Decor: shared squashed pale icosahedron for an InstancedMesh (seed ignored). */
export function buildSnowBush(): BuiltProp {
  return snowBush.build(0);
}

// ballRock always yields a ball collider exposing the radius fn that draws
// the same first RNG value as the visual; delegate so iceRockRadius tracks
// the archetype's rMin/rMax knob and stays the single source of truth.
const iceRockRadiusOf =
  iceRock.collider.shape === "ball"
    ? iceRock.collider.radius
    : (seed: number): number => makeRNG(seed).range(0.8, 1.5);

/**
 * Base dodeca radius for an iceRock seed. Delegates to the ballRock
 * archetype's radius fn so the visual + Rapier ball collider share the
 * first RNG draw (PropField.createBody parity). Stable:
 * iceRockRadius(s) == makeRNG(s).range(0.8, 1.5).
 */
export function iceRockRadius(seed: number): number {
  return iceRockRadiusOf(seed);
}

// ---------------------------------------------------------------------------
// registry wiring (pure addition; a later commit selects biome flora)
// ---------------------------------------------------------------------------

registerFlora("pine", {
  build: pine.build,
  big: true,
  // Collider pinned to the bespoke tundra contract: the archetype derives
  // radius 0.9 from trunkRadius 0.6 (1.5x heuristic); the tundra pine keeps
  // radius 0.8 + halfHeight 2.5 so a kart drives the same collision proxy.
  collider: { shape: "cylinder", halfHeight: 2.5, radius: 0.8 },
});

registerFlora("iceRock", iceRock);

registerFlora("snowBush", snowBush);
