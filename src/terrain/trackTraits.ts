/**
 * 059/060 per-biome track character. Pure data: a biome (or any caller)
 * describes how its roads should FEEL — width band, how much the width
 * breathes along the lap, how often the circuit forks, and which fork kind
 * the biome favors. generateCircuit consumes the resolved traits; biomes
 * carry only overrides (undefined = defaults, mirroring BiomeDefinition's
 * terrain override pattern).
 */

/**
 * Layout personality a seed draws before its mainline attempts: `classic`
 * is the pre-archetype generic mix; `flow` favors sweepers, `technical`
 * hairpins + chicanes, `power` long straights.
 */
export type LayoutArchetype = "classic" | "flow" | "technical" | "power";

/** Draw order for the weighted archetype roll (stable across builds). */
export const ARCHETYPES: readonly LayoutArchetype[] = ["classic", "flow", "technical", "power"];

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
  /**
   * Relative weights for the per-seed archetype draw. Missing keys resolve
   * to 1 (equal chance); all-zero falls back to the equal-weight default.
   */
  archetypeWeights: Readonly<Partial<Record<LayoutArchetype, number>>>;
  /** Multiplier on the elevation amplitude (0.25..2; 1 = baseline). */
  elevationScale: number;
  /** 0..1 weight of a guaranteed 1-cycle climb/descent per lap. */
  hillBias: number;
  /** Max corner bank angle (rad, clamped 0..12 deg; 0 = level roads). */
  bankMax: number;
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
  archetypeWeights: { classic: 1, flow: 1, technical: 1.8, power: 0.8 },
  elevationScale: 1,
  hillBias: 0,
  bankMax: (10 * Math.PI) / 180,
};

/** Hard ceiling on the bank angle (rad): suspension + grip stay safe. */
export const BANK_MAX_CEILING = (12 * Math.PI) / 180;

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
  t.elevationScale = Math.min(2, Math.max(0.25, t.elevationScale));
  t.hillBias = Math.min(1, Math.max(0, t.hillBias));
  t.bankMax = Math.min(BANK_MAX_CEILING, Math.max(0, t.bankMax));
  const weights: Partial<Record<LayoutArchetype, number>> = {};
  let total = 0;
  for (const a of ARCHETYPES) {
    const w = Math.max(0, t.archetypeWeights[a] ?? 1);
    weights[a] = w;
    total += w;
  }
  t.archetypeWeights = total > 0 ? weights : DEFAULT_TRACK_TRAITS.archetypeWeights;
  return t;
}
