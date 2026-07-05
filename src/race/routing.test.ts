import { describe, expect, it } from "vitest";
import { SplineTrack } from "../terrain/SplineTrack";
import { TrackGraph, type BranchEdgeInit } from "../terrain/trackGraph";
import { advanceOnRoute, respawnPoseOnGraph, samplePathAhead } from "./routing";
import type { AiSplinePoint } from "./AiDriver";

/** Same synthetic outward-bow fixture as the terrain branch-field suite. */
const TA = 0.25;
const TB = 0.45;

function buildGraph(): { track: SplineTrack; graph: TrackGraph } {
  const track = new SplineTrack();
  const pts: Array<readonly [number, number, number]> = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = TA + (TB - TA) * u;
    const idx = Math.round(t * track.sx.length) % track.sx.length;
    const x = track.sx[idx]!;
    const z = track.sz[idx]!;
    const r = Math.hypot(x, z) || 1;
    const rise = smooth01(u / 0.35) * smooth01((1 - u) / 0.35);
    const off = 30 * rise;
    pts.push([x + (x / r) * off, track.sy[idx]!, z + (z / r) * off]);
  }
  const branch: BranchEdgeInit = { kind: "shortcut", tA: TA, tB: TB, points: pts, halfWidth: 4 };
  return { track, graph: new TrackGraph(track, { branches: [branch] }) };
}

function smooth01(v: number): number {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
}

function makeBuf(n: number): AiSplinePoint[] {
  return Array.from({ length: n }, () => ({ x: 0, z: 0, halfWidth: 0 }));
}

describe("routing (060)", () => {
  const { graph } = buildGraph();
  const main = graph.edgeById(0);
  const branch = graph.edgeById(1);
  const L = graph.loopLength;

  it("advanceOnRoute stays on the mainline without a plan", () => {
    const cur = { edgeId: 0, s: 0.2 * L };
    advanceOnRoute(graph, undefined, cur, 0.1 * L);
    expect(cur.edgeId).toBe(0);
    expect(cur.s).toBeCloseTo(0.3 * L, 5);
  });

  it("advanceOnRoute diverts onto a taken branch at its entry", () => {
    const plan = new Map([[1, true]]);
    const cur = { edgeId: 0, s: 0.2 * L };
    advanceOnRoute(graph, plan, cur, 0.1 * L);
    expect(cur.edgeId).toBe(1);
    expect(cur.s).toBeCloseTo(0.1 * L - (TA - 0.2) * L, 4);
  });

  it("advanceOnRoute continues onto the mainline past a branch end", () => {
    const cur = { edgeId: 1, s: branch.length - 5 };
    advanceOnRoute(graph, undefined, cur, 20);
    expect(cur.edgeId).toBe(0);
    expect(cur.s).toBeCloseTo((TB * L + 15) % L, 3);
  });

  it("samplePathAhead follows a taken branch (width switches) and merges back", () => {
    const plan = new Map([[1, true]]);
    const buf = samplePathAhead(graph, plan, 0, (TA - 0.01) * L, 8, makeBuf(48));
    const widths = buf.map((p) => p.halfWidth);
    expect(widths.some((w) => Math.abs(w - 4) < 0.5)).toBe(true);
    // Horizon 48 * 8 = 384 m > branch (~130 m) -> the tail is mainline again.
    expect(Math.abs(widths[widths.length - 1]! - 6)).toBeLessThan(0.5);
    // Consecutive samples stay contiguous (no teleports along the walk).
    for (let i = 1; i < buf.length; i++) {
      const d = Math.hypot(buf[i]!.x - buf[i - 1]!.x, buf[i]!.z - buf[i - 1]!.z);
      expect(d).toBeLessThan(20);
    }
  });

  it("samplePathAhead skips the branch without a plan entry", () => {
    const buf = samplePathAhead(graph, new Map([[1, false]]), 0, (TA - 0.01) * L, 8, makeBuf(48));
    for (const p of buf) expect(Math.abs(p.halfWidth - 6)).toBeLessThan(0.5);
  });

  it("respawnPoseOnGraph is edge-local: lost beside the branch -> back ON it", () => {
    const p = { x: 0, y: 0, z: 0 };
    branch.pointAt(branch.length / 2, p);
    // Push the kart 6 m outward off the branch centerline.
    const r = Math.hypot(p.x, p.z) || 1;
    const world = {
      graph,
      graphPose: (x: number, z: number) => graph.closestOnGraph(x, z),
      heightAt: () => 0,
    };
    const pose = respawnPoseOnGraph(world, p.x + (p.x / r) * 6, p.z + (p.z / r) * 6, 1.5);
    const back = graph.closestOnGraph(pose.x, pose.z);
    expect(back.edgeId).toBe(1);
    expect(back.dist).toBeLessThan(1.5);
    expect(pose.y).toBeCloseTo(1.5, 5);
    expect(Number.isFinite(pose.yaw)).toBe(true);
  });

  it("respawnPoseOnGraph continues past the merge near a branch end", () => {
    const p = { x: 0, y: 0, z: 0 };
    branch.pointAt(branch.length - 4, p);
    const world = {
      graph,
      graphPose: (x: number, z: number) => graph.closestOnGraph(x, z),
      heightAt: () => 0,
    };
    const pose = respawnPoseOnGraph(world, p.x, p.z, 1.5);
    const back = graph.closestOnGraph(pose.x, pose.z);
    expect(back.edgeId).toBe(0);
    // Landed just past the merge node on the mainline.
    const merged = { x: 0, y: 0, z: 0 };
    main.pointAt(TB * L + 11, merged);
    expect(Math.hypot(pose.x - merged.x, pose.z - merged.z)).toBeLessThan(6);
  });
});
