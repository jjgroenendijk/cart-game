/**
 * 060 AI route choice. Pure: given a branch's character, a rival's
 * personality, and an RNG, decide whether that rival takes the branch.
 * Deterministic in (info, tuning, rng sequence) — FieldBuilder seeds one RNG
 * per (rival, branch) so every rival commits to a stable route per world.
 */

import type { RNG } from "../core/rng";

export interface BranchChoiceInfo {
  kind: "shortcut" | "scenic";
  /** Branch corridor half-width (m). */
  halfWidth: number;
  /** Branch length / mainline window arc (< 1 = shorter, > 1 = longer). */
  lengthRatio: number;
}

/** The personality slice route choice reads (AiTuning satisfies it). */
export interface RouteTuning {
  /** 0..1; higher = braver. */
  aggression: number;
}

/** Probability clamp: every rival can always surprise, never certainty. */
const P_MIN = 0.05;
const P_MAX = 0.95;

/**
 * Take-probability for a branch. Shortcuts attract aggressive drivers and
 * reward shortness but their narrowness deters; scenics invert — cautious
 * drivers prefer the wide, easy road and eat the extra distance.
 */
export function branchTakeProbability(info: BranchChoiceInfo, tuning: RouteTuning): number {
  let p: number;
  if (info.kind === "shortcut") {
    const narrow = clamp01((6 - info.halfWidth) / 3);
    const shorter = clamp01(1 - info.lengthRatio);
    p = 0.2 + 0.55 * tuning.aggression - 0.3 * narrow + 0.35 * shorter;
  } else {
    const wide = clamp01((info.halfWidth - 6) / 3);
    const longer = clamp01(info.lengthRatio - 1);
    p = 0.75 - 0.5 * tuning.aggression + 0.15 * wide - 0.25 * longer;
  }
  return clamp(p, P_MIN, P_MAX);
}

/** One route decision (consumes one rng draw). */
export function chooseBranch(info: BranchChoiceInfo, tuning: RouteTuning, rng: RNG): boolean {
  return rng.next() < branchTakeProbability(info, tuning);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
