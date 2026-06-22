import { describe, expect, it } from "vitest";
import {
  advanceLap,
  buildSectorBoundaries,
  initialLapState,
  LapTracker,
  sectorIndex,
  signedWrapDelta,
  trackProgress,
  wrap01,
  DEFAULT_SECTOR_COUNT,
} from "./checkpoints";

const K = DEFAULT_SECTOR_COUNT; // 6

describe("wrap01", () => {
  it("wraps negatives and values >= 1 into [0,1)", () => {
    expect(wrap01(0)).toBe(0);
    expect(wrap01(1)).toBe(0);
    expect(wrap01(-0.25)).toBeCloseTo(0.75, 6);
    expect(wrap01(1.25)).toBeCloseTo(0.25, 6);
    expect(wrap01(2)).toBe(0);
  });
});

describe("signedWrapDelta", () => {
  it("is positive forward and negative backward across the seam", () => {
    expect(signedWrapDelta(0.1, 0.2)).toBeCloseTo(0.1, 6);
    expect(signedWrapDelta(0.2, 0.1)).toBeCloseTo(-0.1, 6);
    // Forward seam wrap (just below 1 -> just above 0).
    expect(signedWrapDelta(0.99, 0.01)).toBeCloseTo(0.02, 6);
    // Backward seam wrap.
    expect(signedWrapDelta(0.01, 0.99)).toBeCloseTo(-0.02, 6);
  });

  it("returns values within (-0.5, 0.5]", () => {
    for (let i = 0; i < 200; i++) {
      const a = Math.random();
      const b = Math.random();
      const d = signedWrapDelta(a, b);
      expect(d).toBeGreaterThan(-0.5);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("sectorIndex", () => {
  it("maps t to sectors 0..k-1", () => {
    expect(sectorIndex(0, K)).toBe(0);
    expect(sectorIndex(1 / K - 1e-6, K)).toBe(0);
    expect(sectorIndex(1 / K, K)).toBe(1);
    expect(sectorIndex((K - 1) / K, K)).toBe(K - 1);
    expect(sectorIndex(0.999, K)).toBe(K - 1);
  });

  it("wraps out-of-range t", () => {
    expect(sectorIndex(1, K)).toBe(0);
    expect(sectorIndex(-0.1, K)).toBe(K - 1);
  });
});

describe("buildSectorBoundaries", () => {
  it("places K boundaries at i/K with the start line at 0", () => {
    const b = buildSectorBoundaries(K);
    expect(b).toHaveLength(K);
    expect(b[0]).toBe(0);
    expect(b[K - 1]).toBeCloseTo((K - 1) / K, 6);
  });
});

describe("trackProgress", () => {
  it("reports forward delta and the two sectors", () => {
    const p = trackProgress(0.1, 0.2, K);
    expect(p.forwardDelta).toBeCloseTo(0.1, 6);
    expect(p.prevSector).toBe(0);
    expect(p.sector).toBe(1);
  });

  it("handles the forward seam wrap", () => {
    const p = trackProgress(0.99, 0.01, K);
    expect(p.forwardDelta).toBeCloseTo(0.02, 6);
    expect(p.prevSector).toBe(K - 1);
    expect(p.sector).toBe(0);
  });
});

describe("advanceLap — lap validity", () => {
  it("awards a lap only after every sector is crossed in order", () => {
    let s = initialLapState(0.95, K); // spawn behind the line, sector K-1
    s = advanceLap(s, 0.95, K).state; // prime

    // Cross the start line forward -> begin chain.
    let r = advanceLap(s, 0.01, K);
    s = r.state;
    expect(r.cut).toBe(false);
    expect(s.nextGate).toBe(1);

    // Drive through sectors 1..K-1 in order.
    for (let g = 1; g < K; g++) {
      r = advanceLap(s, (g + 0.5) / K, K);
      s = r.state;
      expect(r.cut).toBe(false);
      expect(s.nextGate).toBe(g + 1);
    }
    // All gates down; crossing the line again must NOT award until the crossing.
    expect(s.lap).toBe(0);

    // Cross the start line forward -> lap awarded.
    r = advanceLap(s, 0.01, K);
    expect(r.lapCompleted).toBe(true);
    expect(r.state.lap).toBe(1);
    expect(r.cut).toBe(false);
  });

  it("does NOT award a lap when sectors are reversed (backward move)", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    s = advanceLap(s, 0.01, K).state; // begin
    expect(s.nextGate).toBe(1);

    // Reverse back across the line (sector 0 -> K-1, backward).
    const r = advanceLap(s, 0.95, K);
    expect(r.lapCompleted).toBe(false);
    expect(r.state.lap).toBe(0);
    // Chain unchanged by a backward move.
    expect(r.state.nextGate).toBe(1);
  });

  it("invalidates the lap when a sector is skipped (cut)", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    s = advanceLap(s, 0.01, K).state; // begin, nextGate=1

    // Skip gate 1: jump forward from sector 0 into sector 2.
    const r = advanceLap(s, (2 + 0.1) / K, K);
    expect(r.cut).toBe(true);
    expect(r.lapCompleted).toBe(false);
    expect(r.state.nextGate).toBe(0); // chain reset
    expect(r.state.lap).toBe(0);
  });

  it("counts the forward seam wrap as a valid line crossing", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    // Begin + clear all gates.
    s = advanceLap(s, 0.01, K).state; // begin
    for (let g = 1; g < K; g++) s = advanceLap(s, (g + 0.5) / K, K).state;
    expect(s.nextGate).toBeGreaterThanOrEqual(K);

    // Forward wrap 0.99 -> 0.01 is the line crossing.
    const r = advanceLap(s, 0.01, K);
    expect(r.lapCompleted).toBe(true);
  });

  it("treats an early line crossing (gates missing) as a cut", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    s = advanceLap(s, 0.01, K).state; // begin, nextGate=1 (no gates cleared)
    // Cross the line again immediately without clearing gates.
    s = advanceLap(s, (K - 1 + 0.5) / K, K).state; // drive to sector K-1
    const r = advanceLap(s, 0.01, K); // line crossing, gates missing
    expect(r.cut).toBe(true);
    expect(r.lapCompleted).toBe(false);
  });

  it("is monotonic: gates only advance forward into the expected sector", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    s = advanceLap(s, 0.01, K).state; // begin
    // Wobble back into sector 0 while nextGate=1 -> ignored, no advance.
    const before = s.nextGate;
    let r = advanceLap(s, 0.005, K); // still sector 0
    expect(r.state.nextGate).toBe(before);
    // Entering sector 1 advances.
    r = advanceLap(r.state, (1 + 0.5) / K, K);
    expect(r.state.nextGate).toBe(2);
  });

  it("teleport jump beyond the cut band is a cut", () => {
    let s = initialLapState(0.95, K);
    s = advanceLap(s, 0.95, K).state; // prime
    s = advanceLap(s, 0.01, K).state; // begin
    // Huge forward jump (~half the loop) in one step.
    const r = advanceLap(s, 0.5, K);
    expect(r.cut).toBe(true);
  });
});

describe("LapTracker", () => {
  it("runs a full clean lap via the convenience class", () => {
    const tr = new LapTracker(K);
    tr.reset(0.95);
    let laps = 0;
    // First prime + begin crossing.
    tr.update(0.95);
    laps += tr.update(0.01).lapCompleted ? 1 : 0;
    for (let g = 1; g < K; g++) tr.update((g + 0.5) / K);
    laps += tr.update(0.01).lapCompleted ? 1 : 0;
    expect(tr.lap).toBe(1);
    expect(laps).toBe(1);
  });

  it("is deterministic: same t sequence -> same lap count", () => {
    // Clean monotonic pass: begin, enter sectors 1..K-1, cross the line.
    const centers = [0.08];
    for (let g = 1; g < K; g++) centers.push((g + 0.5) / K);
    const seq = [0.95, 0.01, ...centers.slice(1), 0.01];
    const run = (): number => {
      const t = new LapTracker(K);
      t.reset(0.95);
      let laps = 0;
      for (const v of seq) laps += t.update(v).lapCompleted ? 1 : 0;
      return laps;
    };
    expect(run()).toBe(run());
    expect(run()).toBe(1);
  });
});
