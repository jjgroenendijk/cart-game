import { describe, expect, it } from "vitest";
import { generateCircuit } from "./circuit";
import {
  BRANCH_SPAN_MAX,
  BRANCH_T_MAX,
  BRANCH_T_MIN,
  SEP_MIN_BRANCH,
  branchRejectReason,
  generateBranches,
  sampleMainline,
} from "./circuitBranch";
import { SampleIndex } from "./trackGraph";
import { resolveTrackTraits } from "./trackTraits";

/** Traits that always request 2 branches (maximizes sweep coverage). */
const EAGER = resolveTrackTraits({ branchChance: 2 });

describe("generateBranches (060 sweep)", () => {
  it("every emitted branch satisfies the placement invariants", () => {
    let emitted = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const circuit = generateCircuit(seed, EAGER);
      const branches = generateBranches(seed, circuit.control, EAGER);
      const m = sampleMainline(circuit.control);
      const index = new SampleIndex(m.x, m.z);
      for (let bi = 0; bi < branches.length; bi++) {
        const b = branches[bi]!;
        emitted++;
        // The emitted branch re-validates cleanly against the full rule set
        // (window/span, endpoints, tangents, radius, ratio, grade,
        // ramp-scoped separation + plateau coverage, branch-branch).
        expect(branchRejectReason(m, index, b, branches.slice(0, bi))).toBeNull();
        // Spot-check the plan-level invariants directly.
        expect(b.tA).toBeGreaterThanOrEqual(BRANCH_T_MIN);
        expect(b.tB).toBeLessThanOrEqual(BRANCH_T_MAX);
        expect(b.tB - b.tA).toBeLessThanOrEqual(BRANCH_SPAN_MAX + 1e-9);
        if (b.kind === "shortcut") {
          expect(b.halfWidth).toBeGreaterThanOrEqual(3.5);
          expect(b.halfWidth).toBeLessThanOrEqual(4.5);
        } else {
          expect(b.halfWidth).toBeGreaterThanOrEqual(7.5);
          expect(b.halfWidth).toBeLessThanOrEqual(9);
        }
        // The branch genuinely diverges: some points reach full separation.
        let plateau = 0;
        for (const p of b.points) {
          const k = index.nearestSample(p[0], p[2]);
          if (Math.sqrt(index.sampleDistSq(k, p[0], p[2])) >= SEP_MIN_BRANCH) plateau++;
        }
        expect(plateau).toBeGreaterThan(0);
      }
    }
    // The sweep must actually exercise branches (drop-on-failure is allowed
    // per seed, but a generator that never places one is broken).
    expect(emitted).toBeGreaterThanOrEqual(6);
  });

  it("is deterministic in (seed, control, traits)", () => {
    const circuit = generateCircuit(5, EAGER);
    const a = generateBranches(5, circuit.control, EAGER);
    const b = generateBranches(5, circuit.control, EAGER);
    expect(a).toEqual(b);
  });

  it("branchChance 0 emits no branches", () => {
    const traits = resolveTrackTraits({ branchChance: 0 });
    const circuit = generateCircuit(7, traits);
    expect(generateBranches(7, circuit.control, traits)).toEqual([]);
    expect(circuit.branches).toEqual([]);
  });

  it("generateCircuit carries its branches and covers them with worldSize", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const c = generateCircuit(seed, EAGER);
      for (const b of c.branches) {
        for (const p of b.points) {
          expect(Math.abs(p[0])).toBeLessThanOrEqual(c.worldSize / 2);
          expect(Math.abs(p[2])).toBeLessThanOrEqual(c.worldSize / 2);
        }
      }
    }
  });
});
