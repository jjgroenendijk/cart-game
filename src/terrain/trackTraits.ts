/**
 * 059/060 per-biome track character. Pure data: a biome (or any caller)
 * describes how its roads should FEEL — width band, how much the width
 * breathes along the lap, how often the circuit forks, and which fork kind
 * the biome favors. generateCircuit consumes the resolved traits; biomes
 * carry only overrides (undefined = defaults, mirroring BiomeDefinition's
 * terrain override pattern).
 */

export interface TrackTraits {
  /** Narrowest corridor half-width the generator may emit (m). */
  widthMin: number;
  /** Widest corridor half-width the generator may emit (m). */
  widthMax: number;
  /** 0..1: how strongly the width swings across its [min, max] band. */
  widthVariation: number;
  /**
   * Expected branches per circuit (0..2). The integer part is guaranteed
   * attempts; the fraction is the probability of one more (060).
   */
  branchChance: number;
  /** Fork-kind preference for generated branches (060). */
  branchBias: "shortcut" | "scenic" | "balanced";
}

/**
 * Baseline traits (temperate parity): the 059 plan's 4.5-9 m width band with
 * moderate variation, and a moderate chance of a single fork.
 */
export const DEFAULT_TRACK_TRAITS: TrackTraits = {
  widthMin: 4.5,
  widthMax: 9,
  widthVariation: 0.6,
  branchChance: 0.7,
  branchBias: "balanced",
};

/**
 * Merge trait overrides over the defaults. The width band is sanity-ordered
 * (min <= max) and widthMax is floored at 6 m so the 2-column start grid
 * (lateral 2.0 m straddle) always fits the start-zone width floor.
 */
export function resolveTrackTraits(overrides?: Partial<TrackTraits>): TrackTraits {
  const t = { ...DEFAULT_TRACK_TRAITS, ...overrides };
  t.widthMax = Math.max(t.widthMax, 6);
  t.widthMin = Math.min(t.widthMin, t.widthMax);
  t.widthVariation = Math.min(1, Math.max(0, t.widthVariation));
  t.branchChance = Math.min(2, Math.max(0, t.branchChance));
  return t;
}
