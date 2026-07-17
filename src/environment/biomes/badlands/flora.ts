import { registerFlora } from "../../floraRegistry";
import { ballRock, coniferTree, groundDecor, lumpyShrub } from "../../flora/archetypes";

/**
 * Badlands flora: 4 archetype-built cel kinds, no bespoke geometry. A squat
 * juniper spire and a big flattened red butte anchor the canyon floor (both
 * big props with colliders); low dry scrub and sparse straw tufts fill the
 * ground (decor, no collider). All pigments align to the rust-red terrain so
 * props read as part of the badlands rock.
 *
 * Decor builders (scrubBrush/dryTuft) ignore the seed arg (shared template) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

/** Palette (sRGB hex; aligned to the badlands terrain so props belong to it). */
const JUNIPER_FOLIAGE = [0x6f7a5a, 0x7a8560] as const;
const JUNIPER_TRUNK_COLOR = 0x6a4a34;
const BUTTE_ROCK_COLOR = 0xa04a30;
const SCRUB_BRUSH_COLOR = 0x8a6a44;
const DRY_TUFT_COLORS = [0xbfa36a, 0xc9b078] as const;

// Squat juniper: short trunk + few dusty grey-green tiers hugging the mesa,
// not a tall alpine spire. big=true, cylinder collider (from coniferTree).
const juniper = coniferTree({
  trunkHRange: [3.5, 5],
  trunkRadius: 0.4,
  tierCounts: [3, 4],
  tierRadius: 1.9,
  tierH: 2.2,
  foliage: JUNIPER_FOLIAGE,
  trunkColor: JUNIPER_TRUNK_COLOR,
});

// Butte: a big flattened red-sandstone boulder anchoring the canyon floor.
// big=true, ball collider tracking the visual radius (from ballRock).
const butteRock = ballRock({
  rMin: 1.8,
  rMax: 3,
  flatten: 0.65,
  color: BUTTE_ROCK_COLOR,
});

// Scrub brush: low tan-brown dry desert scrub. Decor (big=false), no collider.
const scrubBrush = lumpyShrub({
  r: 0.55,
  squashY: 0.6,
  color: SCRUB_BRUSH_COLOR,
  yOffset: 0.28,
});

// Dry tuft: sparse straw-coloured dry grass blades. Decor, no collider.
const dryTuft = groundDecor({
  mode: "blade",
  h: 0.45,
  count: 3,
  palette: DRY_TUFT_COLORS,
});

// ---------------------------------------------------------------------------
// registry wiring (side-effect at module load)
// ---------------------------------------------------------------------------

registerFlora("juniper", juniper);

registerFlora("butteRock", butteRock);

registerFlora("scrubBrush", scrubBrush);

registerFlora("dryTuft", dryTuft);
