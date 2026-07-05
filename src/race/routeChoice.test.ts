import { describe, expect, it } from "vitest";
import { branchTakeProbability, chooseBranch, type BranchChoiceInfo } from "./routeChoice";
import { makeRNG } from "../core/rng";

const SHORTCUT: BranchChoiceInfo = { kind: "shortcut", halfWidth: 4, lengthRatio: 0.75 };
const SCENIC: BranchChoiceInfo = { kind: "scenic", halfWidth: 8, lengthRatio: 1.3 };

function takeRate(info: BranchChoiceInfo, aggression: number, draws = 4000): number {
  const rng = makeRNG(42);
  let takes = 0;
  for (let i = 0; i < draws; i++) {
    if (chooseBranch(info, { aggression }, rng)) takes++;
  }
  return takes / draws;
}

describe("routeChoice (060)", () => {
  it("is deterministic per (info, tuning, rng seed)", () => {
    const a = chooseBranch(SHORTCUT, { aggression: 0.8 }, makeRNG(7));
    const b = chooseBranch(SHORTCUT, { aggression: 0.8 }, makeRNG(7));
    expect(a).toBe(b);
  });

  it("aggression raises shortcut take-rate and lowers scenic take-rate", () => {
    expect(takeRate(SHORTCUT, 0.95)).toBeGreaterThan(takeRate(SHORTCUT, 0.55) + 0.05);
    expect(takeRate(SCENIC, 0.95)).toBeLessThan(takeRate(SCENIC, 0.55) - 0.05);
  });

  it("narrower shortcuts deter; shorter shortcuts attract", () => {
    const wide = branchTakeProbability({ ...SHORTCUT, halfWidth: 4.5 }, { aggression: 0.8 });
    const narrow = branchTakeProbability({ ...SHORTCUT, halfWidth: 3.5 }, { aggression: 0.8 });
    expect(wide).toBeGreaterThan(narrow);
    const short = branchTakeProbability({ ...SHORTCUT, lengthRatio: 0.6 }, { aggression: 0.8 });
    const long = branchTakeProbability({ ...SHORTCUT, lengthRatio: 0.95 }, { aggression: 0.8 });
    expect(short).toBeGreaterThan(long);
  });

  it("probabilities stay inside [0.05, 0.95] at the extremes", () => {
    const pMax = branchTakeProbability(
      { kind: "shortcut", halfWidth: 6, lengthRatio: 0 },
      { aggression: 1 },
    );
    const pMin = branchTakeProbability(
      { kind: "shortcut", halfWidth: 0, lengthRatio: 1 },
      { aggression: 0 },
    );
    expect(pMax).toBeLessThanOrEqual(0.95);
    expect(pMin).toBeGreaterThanOrEqual(0.05);
  });
});
