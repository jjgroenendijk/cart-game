/**
 * 084 layout archetypes: the per-seed personality draw and its MainlineOpts
 * bases. Each seed rolls one archetype (weighted by traits) before its
 * mainline attempts; `archetypeOpts` lerps every knob from the personality
 * base (t = 0) to the same gentle endpoint `tamedOpts` converges to (t = 1),
 * so taming and termination behavior stay archetype-independent.
 * jsdom-safe (no three/WebGL).
 */

import { makeRNG } from "../core/rng";
import type { MainlineOpts } from "./circuitGen";
import { DEFAULT_CORNER_MIX, type CornerMix } from "./circuitShape";
import {
  ARCHETYPES,
  DEFAULT_TRACK_TRAITS,
  type LayoutArchetype,
  type TrackTraits,
} from "./trackTraits";
import type { CircuitAnalysis } from "./circuit";

/** Per-archetype base knobs at attempt t = 0 (untamed personality). */
interface ArchetypeBase {
  disp: readonly [number, number];
  elong: readonly [number, number];
  minFolds: number;
  maxFolds: number;
  chicanes: readonly [number, number];
  smooth: number;
  length: readonly [number, number];
  mix: CornerMix;
  elevAmpScale: number;
}

// Length caps stay <= 1480: the accept gate measures 3-D curve length while
// the generator normalizes XZ length, so elevation needs ~2% headroom under
// LEN_MAX = 1530. Power's elongation caps at 1.7: scalePlanXZ under
// WORLD_CAP shrinks radii, so higher elongation just burns attempts.
const ARCHETYPE_BASES: Readonly<Record<LayoutArchetype, ArchetypeBase>> = {
  classic: {
    disp: [0.05, 0.13],
    elong: [1.0, 1.45],
    minFolds: 1,
    maxFolds: 3,
    chicanes: [1, 2],
    smooth: 0.18,
    length: [600, 1500],
    mix: DEFAULT_CORNER_MIX,
    elevAmpScale: 1,
  },
  flow: {
    disp: [0.04, 0.09],
    elong: [1.0, 1.35],
    minFolds: 0,
    maxFolds: 1,
    chicanes: [1, 2],
    smooth: 0.26,
    length: [800, 1480],
    mix: { hard: 0.1, medium: 0.35, sweeper: 0.55 },
    elevAmpScale: 1.2,
  },
  technical: {
    disp: [0.06, 0.13],
    elong: [1.0, 1.3],
    minFolds: 2,
    maxFolds: 3,
    chicanes: [2, 3],
    smooth: 0.16,
    length: [650, 1100],
    mix: { hard: 0.55, medium: 0.35, sweeper: 0.1 },
    elevAmpScale: 0.8,
  },
  power: {
    disp: [0.04, 0.1],
    elong: [1.35, 1.7],
    minFolds: 0,
    maxFolds: 1,
    chicanes: [0, 1],
    smooth: 0.2,
    length: [900, 1480],
    mix: { hard: 0.3, medium: 0.3, sweeper: 0.4 },
    elevAmpScale: 1,
  },
};

/**
 * Weighted per-seed archetype draw from its own sub-seed (like the width
 * draw), so the personality of a seed is independent of the attempt loop.
 */
export function drawArchetype(
  seed: number,
  traits: TrackTraits = DEFAULT_TRACK_TRAITS,
): LayoutArchetype {
  const rng = makeRNG(Math.imul((seed >>> 0) ^ 0x2c9277b5, 0x9e3779b1) >>> 0 || 1);
  let total = 0;
  const ws = ARCHETYPES.map((a) => {
    const w = Math.max(0, traits.archetypeWeights[a] ?? 1);
    total += w;
    return w;
  });
  if (total <= 0) return "classic";
  let roll = rng.next() * total;
  for (let i = 0; i < ARCHETYPES.length; i++) {
    roll -= ws[i]!;
    if (roll < 0) return ARCHETYPES[i]!;
  }
  return "classic";
}

/**
 * Archetype knobs lerped from the personality base (t = 0) toward the same
 * gentle tamed endpoint tamedOpts converges to (t = 1), so every archetype
 * keeps the attempt loop's termination behavior. `archetypeOpts("classic", t)`
 * reproduces `tamedOpts(t)` exactly (plus the explicit new-knob defaults).
 */
export function archetypeOpts(a: LayoutArchetype, t: number): MainlineOpts {
  const b = ARCHETYPE_BASES[a];
  const maxFolds =
    t < 0.5 ? b.maxFolds : t < 0.8 ? Math.min(b.maxFolds, 2) : Math.min(b.maxFolds, 1);
  return {
    dispAmpRange: [lerp(b.disp[0], 0.03, t), lerp(b.disp[1], 0.06, t)],
    elongRange: [lerp(b.elong[0], 1.0, t), lerp(b.elong[1], 1.15, t)],
    featureScale: lerp(1, 0.4, t),
    maxFolds,
    minFolds: Math.min(b.minFolds, maxFolds),
    chicaneRange: b.chicanes,
    smoothFactor: lerp(b.smooth, 0.34, t),
    lengthRange: [lerp(b.length[0], 600, t), lerp(b.length[1], 1500, t)],
    cornerMix: b.mix,
    elevAmpScale: b.elevAmpScale,
  };
}

/**
 * Per-archetype "interesting" gate for early attempts: each personality is
 * held to its own signature instead of the generic anti-oval bar. Attempts
 * 6-7 fall back to the generic gate; >= 8 accepts plain-valid (caller).
 */
export function isInteresting(a: LayoutArchetype, v: CircuitAnalysis, attempt: number): boolean {
  const generic = v.hairpins >= 1 || v.sBends >= 2 || v.cornerCount >= 7;
  if (attempt >= 6) return generic;
  switch (a) {
    case "classic":
      return generic;
    case "flow":
      return v.sBends >= 1 && v.cornerCount >= 5;
    case "technical":
      return v.hairpins >= 2 || (v.hairpins >= 1 && v.sBends >= 2);
    case "power":
      return v.longestStraight >= 150 && v.cornerCount >= 4;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
