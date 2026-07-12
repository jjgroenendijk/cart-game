import { makeRNG } from "../../../core/rng";
import { type BuiltProp } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, coniferTree, groundDecor, lumpyShrub, snagTree } from "../../flora/archetypes";

/**
 * Tundra flora: 6 cold-palette cel kinds, all archetype-built. The frozen
 * forest is now sparse but tall: per-seed 8-11 m snow-capped pines (~11-15 m
 * total) over drifted plains, punctuated by dark dead spruces and pale
 * glacial erratic boulders, with snow bushes + frost tufts at ground level.
 *
 * Decor builders (snowBush/frostTuft) ignore the seed arg (shared template)
 * — `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; cold/icy read aligned to a pale tundra terrain). */
const PINE_FOLIAGE_COLOR = 0x5a7868;
const PINE_SNOW_CAP_COLOR = 0xeaf0f3;
const PINE_TRUNK_COLOR = 0x4a3d34;
const ICE_ROCK_COLOR = 0xb0c8d4;
const SNOW_BUSH_COLOR = 0xd8dde0;
const DEAD_SPRUCE_COLOR = 0x5a4f46;
const ERRATIC_COLOR = 0xc2d2da;
const FROST_TUFT_COLORS = [0xc8d8dc, 0xb8ccd4, 0xd8e4e8] as const;

// Tall lone-north pines: per-seed 8-11 m trunks under snow-laden crowns so
// the plain reads as a place where big trees survive, not a bonsai field.
const pine = coniferTree({
  trunkHRange: [8, 11],
  trunkRadius: 0.7,
  tierCounts: [3, 4],
  tierRadius: 4.0,
  tierH: 3.4,
  foliage: [PINE_FOLIAGE_COLOR],
  trunkColor: PINE_TRUNK_COLOR,
  capColor: PINE_SNOW_CAP_COLOR,
});

// Dark dead spruce: a stark silhouette against the pale drifts.
const deadSpruce = snagTree({
  trunkHRange: [5, 8],
  trunkRadius: 0.4,
  limbCounts: [2, 3],
  color: DEAD_SPRUCE_COLOR,
});

// Glacial erratic: big pale boulder dropped on the plain.
const erratic = ballRock({
  rMin: 1.5,
  rMax: 2.6,
  color: ERRATIC_COLOR,
});

// Frost tuft: sparse pale grass poking through the snow crust.
const frostTuft = groundDecor({
  mode: "blade",
  h: 0.55,
  count: 4,
  palette: FROST_TUFT_COLORS,
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
  // Collider pinned wider + taller than the archetype heuristic so a kart
  // never clips the foliage base of the bigger tree (trunk range mid 9.5 m).
  collider: { shape: "cylinder", halfHeight: 4.5, radius: 0.9 },
});

registerFlora("deadSpruce", deadSpruce);

registerFlora("erratic", erratic);

registerFlora("iceRock", iceRock);

registerFlora("snowBush", snowBush);

registerFlora("frostTuft", frostTuft);
