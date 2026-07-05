import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import { SplineFieldCache } from "./heightmap";
import { RIDGE_BLEND, TrackGraph, type BranchEdgeInit } from "./trackGraph";
import { LapTracker, signedWrapDelta } from "../race/checkpoints";

/**
 * 060 synthetic 2-node branch fixture: the default near-circle loop (radius
 * ~60) plus a scenic-style outward bow between tA=0.25 and tB=0.45. The bow
 * is built from the loop's own samples pushed radially outward by a smooth
 * rise-plateau-fall profile, so endpoints are exactly on the mainline and
 * mid-branch separation is well past the carve influence.
 */
const TA = 0.25;
const TB = 0.45;
const DEPTH = 30;

function buildFixture(bowYLift = 0): {
  track: SplineTrack;
  graph: TrackGraph;
  cache: SplineFieldCache;
} {
  const track = new SplineTrack();
  const pts: Array<readonly [number, number, number]> = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = TA + (TB - TA) * u;
    const idx = Math.round(t * track.sx.length) % track.sx.length;
    const x = track.sx[idx]!;
    const y = track.sy[idx]!;
    const z = track.sz[idx]!;
    // Outward = radial for the near-circle loop.
    const r = Math.hypot(x, z) || 1;
    const rise = smooth01(u / 0.35) * smooth01((1 - u) / 0.35);
    const off = DEPTH * rise;
    pts.push([x + (x / r) * off, y + bowYLift * rise, z + (z / r) * off]);
  }
  const branch: BranchEdgeInit = { kind: "scenic", tA: TA, tB: TB, points: pts, halfWidth: 8 };
  const graph = new TrackGraph(track, { branches: [branch] });
  const cache = new SplineFieldCache(graph, 100, 2);
  return { track, graph, cache };
}

function smooth01(v: number): number {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
}

describe("branch field cache (060 fixture)", () => {
  const { track, graph, cache } = buildFixture();
  const branchEdge = graph.edgeById(1);

  it("projected t is monotonic along the branch and equal at the junctions", () => {
    expect(branchEdge.progressAt(0)).toBeCloseTo(TA, 3);
    expect(branchEdge.progressAt(branchEdge.length)).toBeCloseTo(TB, 3);
    let prev = -Infinity;
    for (let s = 0; s <= branchEdge.length; s += branchEdge.length / 64) {
      const t = branchEdge.progressAt(s);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it("queryPose follows the branch with monotonic forward t (no cross-edge blend)", () => {
    const p = { x: 0, y: 0, z: 0 };
    let prevT: number | null = null;
    for (let s = 2; s < branchEdge.length - 2; s += 3) {
      branchEdge.pointAt(s, p);
      const pose = cache.queryPose(p.x, p.z);
      // On the branch centerline the pose is on-corridor for width 8.
      expect(pose.dist).toBeLessThan(4);
      if (prevT !== null) {
        const d = signedWrapDelta(prevT, pose.t);
        expect(d).toBeGreaterThanOrEqual(-1e-4);
        expect(d).toBeLessThan(0.05);
      }
      prevT = pose.t;
    }
  });

  it("mid-branch pose reads the branch width, mainline pose the mainline width", () => {
    const p = { x: 0, y: 0, z: 0 };
    branchEdge.pointAt(branchEdge.length / 2, p);
    expect(cache.queryPose(p.x, p.z).halfWidth).toBeCloseTo(8, 1);
    // Opposite side of the loop: pure mainline.
    const i = Math.round(0.85 * track.sx.length);
    const pose = cache.queryPose(track.sx[i]!, track.sz[i]!);
    expect(pose.halfWidth).toBeCloseTo(6, 1);
  });

  it("laps complete via advanceLap on BOTH routes with no cuts", () => {
    for (const route of ["main", "branch"] as const) {
      const tracker = new LapTracker();
      tracker.reset();
      let cuts = 0;
      let laps = 0;
      const p = { x: 0, y: 0, z: 0 };
      const main = graph.edgeById(0);
      // Walk one lap from the grid anchor (just behind the line) forward.
      const startS = 0.999 * main.length;
      const stepM = 3;
      for (let sM = 0; sM <= main.length + 12; sM += stepM) {
        const s = (startS + sM) % main.length;
        const tMain = s / main.length;
        let pose;
        if (route === "branch" && tMain >= TA && tMain <= TB) {
          const sB = ((tMain - TA) / (TB - TA)) * branchEdge.length;
          branchEdge.pointAt(sB, p);
          pose = cache.queryPose(p.x, p.z);
        } else {
          main.pointAt(s, p);
          pose = cache.queryPose(p.x, p.z);
        }
        const r = tracker.update(pose.t);
        if (r.cut) cuts++;
        if (r.lapCompleted) laps++;
      }
      expect(cuts).toBe(0);
      expect(laps).toBe(1);
    }
  });

  it("a mid-branch hop to the mainline stays under FORWARD_CUT (sector move)", () => {
    const p = { x: 0, y: 0, z: 0 };
    branchEdge.pointAt(branchEdge.length / 2, p);
    const onBranch = cache.queryPose(p.x, p.z);
    const main = graph.edgeById(0);
    const tMid = (TA + TB) / 2;
    main.pointAt(tMid * main.length, p);
    const onMain = cache.queryPose(p.x, p.z);
    expect(Math.abs(signedWrapDelta(onBranch.t, onMain.t))).toBeLessThan(0.34);
  });

  it("ridge-blends pathY between edges (no crease at the equidistant line)", () => {
    // Lift the branch 4 m mid-bow; walk a radial transect from mainline to
    // branch at the bow's midpoint and require pathY steps to stay small.
    const lifted = buildFixture(4);
    const tMid = (TA + TB) / 2;
    const main = lifted.graph.edgeById(0);
    const p = { x: 0, y: 0, z: 0 };
    main.pointAt(tMid * main.length, p);
    const r = Math.hypot(p.x, p.z) || 1;
    const dir = { x: p.x / r, z: p.z / r };
    const pose = { edgeId: 0, s: 0, dist: 0, t: 0, halfWidth: 0, pathY: 0 };
    let prevY: number | null = null;
    let maxStep = 0;
    for (let d = 0; d <= DEPTH; d += 1) {
      lifted.graph.closestOnGraph(p.x + dir.x * d, p.z + dir.z * d, pose);
      if (prevY !== null) maxStep = Math.max(maxStep, Math.abs(pose.pathY - prevY));
      prevY = pose.pathY;
    }
    // Without the ridge blend the edge flip would step ~4 m at once; the
    // blend caps per-metre steps to the lift spread across RIDGE_BLEND.
    expect(maxStep).toBeLessThan((4 / RIDGE_BLEND) * 2.5);
  });
});
