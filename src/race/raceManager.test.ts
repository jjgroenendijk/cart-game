import { describe, expect, it } from "vitest";
import { RaceManager, DEFAULT_TARGET_LAPS } from "./raceManager";
import { DEFAULT_SECTOR_COUNT } from "./checkpoints";

const K = DEFAULT_SECTOR_COUNT;

function centerT(sector: number): number {
  return (sector + 0.5) / K;
}

/** Build a pose array where `idx` moves and all others idle at 0.9. */
function poses(idx: number, t: number, n: number): { t: number }[] {
  return Array.from({ length: n }, (_, i) => (i === idx ? { t } : { t: 0.9 }));
}

/**
 * Drive kart `idx` through one clean lap (gates 1..K-1 then the line crossing).
 * Call begin() first. `n` is the field size; others idle behind the line.
 */
function runLap(m: RaceManager, idx: number, n: number): void {
  for (let g = 1; g < K; g++) m.update(1 / 60, poses(idx, centerT(g), n));
  m.update(1 / 60, poses(idx, 0.01, n)); // start-line crossing
}

/** First forward line crossing from the grid (behind the line) to begin lap 1. */
function beginLine(m: RaceManager, idx: number, n: number): void {
  m.update(1 / 60, poses(idx, 0.01, n));
}

describe("RaceManager — startRace", () => {
  it("constructs in the 'grid' phase with a zero timer", () => {
    const m = new RaceManager({ kartCount: 6 });
    expect(m.phase).toBe("grid");
    expect(m.timer).toBe(0);
  });

  it("startRace zeros state, resets progress, and enters 'racing'", () => {
    const m = new RaceManager({ kartCount: 6, targetLaps: 3 });
    m.update(
      0.5,
      Array.from({ length: 6 }, () => ({ t: 0.9 })),
    ); // no-op pre-start
    expect(m.timer).toBe(0);
    m.startRace();
    expect(m.phase).toBe("racing");
    expect(m.timer).toBe(0);
    // All karts start at 0 laps, behind the line (sector K-1).
    for (let i = 0; i < 6; i++) {
      expect(m.progressOf(i).lap).toBe(0);
      expect(m.progressOf(i).sectorIdx).toBe(K - 1);
      expect(m.progressOf(i).cumArcLen).toBe(0);
    }
  });

  it("startRace is idempotent (calling twice still races from zero)", () => {
    const m = new RaceManager({ kartCount: 3, targetLaps: 2 });
    m.startRace();
    m.update(1, [{ t: 0.01 }, { t: 0.01 }, { t: 0.01 }]);
    expect(m.timer).toBe(1);
    m.startRace();
    expect(m.timer).toBe(0);
    expect(m.phase).toBe("racing");
  });
});

describe("RaceManager — update advances timer + progress", () => {
  it("update advances the timer by dt each step", () => {
    const m = new RaceManager({ kartCount: 2, targetLaps: 5 });
    m.startRace();
    m.update(0.1, [{ t: 0.9 }, { t: 0.9 }]);
    m.update(0.2, [{ t: 0.9 }, { t: 0.9 }]);
    expect(m.timer).toBeCloseTo(0.3, 6);
  });

  it("update accrues cumulative arc length forward (wrap-safe)", () => {
    const m = new RaceManager({ kartCount: 1, targetLaps: 5 });
    m.startRace();
    // gridT = 5/6 ~= 0.8333. First step crosses the seam to 0.02 (forward),
    // then 0.02 -> 0.10. cumArcLen accrues both forward deltas.
    const d1 = 0.02 - 5 / 6 + 1; // wrap forward across the seam
    const d2 = 0.1 - 0.02;
    m.update(1 / 60, [{ t: 0.02 }]);
    m.update(1 / 60, [{ t: 0.1 }]);
    const p = m.progressOf(0);
    expect(p.cumArcLen).toBeCloseTo(d1 + d2, 5);
    expect(p.lap).toBe(0); // crossing the line alone (first) only begins the chain
  });

  it("a full clean lap increments the leader's lap and updates the rank", () => {
    const m = new RaceManager({ kartCount: 2, targetLaps: 3 });
    m.startRace();
    beginLine(m, 0, 2);
    runLap(m, 0, 2);
    expect(m.progressOf(0).lap).toBe(1);
    expect(m.positionOf(0)).toBe(1); // kart 0 leads
    expect(m.positionOf(1)).toBe(2);
  });
});

describe("RaceManager — finish", () => {
  it("fires exactly once when the leader reaches targetLaps", () => {
    const m = new RaceManager({ kartCount: 2, targetLaps: 2 });
    m.startRace();
    beginLine(m, 0, 2);
    runLap(m, 0, 2); // lap 1
    expect(m.phase).toBe("racing"); // target 2 -> not yet
    runLap(m, 0, 2); // lap 2 -> leader finishes
    expect(m.phase).toBe("finished");
    expect(m.progressOf(0).finished).toBe(true);
    expect(m.progressOf(0).finishTime).not.toBeNull();
  });

  it("does not double-finish: update after finished is a no-op (timer frozen)", () => {
    const m = new RaceManager({ kartCount: 1, targetLaps: 1 });
    m.startRace();
    beginLine(m, 0, 1);
    runLap(m, 0, 1);
    expect(m.phase).toBe("finished");
    const frozen = m.timer;
    m.update(5, [{ t: 0.5 }]);
    expect(m.phase).toBe("finished");
    expect(m.timer).toBe(frozen); // frozen
  });

  it("rank reflects post-progress order at finish", () => {
    const m = new RaceManager({ kartCount: 3, targetLaps: 1 });
    m.startRace();
    // Kart 2 completes a lap first; karts 0 and 1 stay idle behind the line.
    beginLine(m, 2, 3);
    runLap(m, 2, 3);
    expect(m.phase).toBe("finished");
    // Kart 2 finished (lap 1) and leads; idle karts tie on (0, 0) -> index order.
    expect(m.orderList[0]).toBe(2);
    expect(m.positionOf(2)).toBe(1);
  });
});

describe("RaceManager — rubber-band", () => {
  it("returns 1 for P1 (human) always", () => {
    const m = new RaceManager({ kartCount: 4 });
    m.startRace();
    expect(m.rubberBandScale(0)).toBe(1);
  });

  it("boosts trailing rivals and eases leading rivals (relative to P1)", () => {
    const m = new RaceManager({ kartCount: 3, targetLaps: 5 });
    m.startRace();
    // P1 (0) midpoint; rival 1 trails P1; rival 2 leads P1.
    m["prog"][0]!.cumArcLen = 0.5;
    m["prog"][1]!.cumArcLen = 0.2; // gap = +0.3 -> boost
    m["prog"][2]!.cumArcLen = 0.8; // gap = -0.3 -> ease
    m["recomputeRank"]();
    expect(m.rubberBandScale(1)).toBeGreaterThan(1);
    expect(m.rubberBandScale(1)).toBeLessThanOrEqual(1.08);
    expect(m.rubberBandScale(2)).toBeLessThan(1);
    expect(m.rubberBandScale(2)).toBeGreaterThanOrEqual(0.95);
    // P1 itself is always neutral.
    expect(m.rubberBandScale(0)).toBe(1);
  });

  it("is disabled when rubberBand:false", () => {
    const m = new RaceManager({ kartCount: 3, rubberBand: false });
    m.startRace();
    expect(m.rubberBandScale(1)).toBe(1);
  });
});

describe("RaceManager — snapshot", () => {
  it("snapshot buffer is independent of the manager's internal state", () => {
    const m = new RaceManager({ kartCount: 2, targetLaps: DEFAULT_TARGET_LAPS });
    m.startRace();
    m.update(0.25, [{ t: 0.9 }, { t: 0.9 }]);
    const s = m.snapshot();
    expect(s.phase).toBe("racing");
    expect(s.timer).toBeCloseTo(0.25, 6);
    expect(s.positions).toHaveLength(2);
    s.positions[0] = 99;
    // Mutating the snapshot buffer does not affect the manager.
    expect(m.positionOf(0)).not.toBe(99);
  });

  it("snapshot reuses one buffer across calls (no per-frame allocation)", () => {
    const m = new RaceManager({ kartCount: 2, targetLaps: DEFAULT_TARGET_LAPS });
    m.startRace();
    const s1 = m.snapshot();
    m.update(0.25, [{ t: 0.9 }, { t: 0.9 }]);
    const s2 = m.snapshot();
    // Same reference -> reused buffer.
    expect(s2).toBe(s1);
    expect(s2.positions).toBe(s1.positions);
    expect(s2.order).toBe(s1.order);
    expect(s2.progress).toBe(s1.progress);
    // And reflects the latest state (timer advanced).
    expect(s2.timer).toBeCloseTo(0.25, 6);
  });
});

describe("RaceManager — mode-dependent finish (008)", () => {
  it("defaults to leader finish + 1 human (1P / 007 behavior)", () => {
    const m = new RaceManager({ kartCount: 6 });
    expect(m.finishWhen).toBe("leader");
    expect(m.humanCount).toBe(1);
  });

  it("2P keeps racing after one human finishes until both humans finish", () => {
    const m = new RaceManager({
      kartCount: 3,
      targetLaps: 2,
      finishWhen: "allHumans",
      humanCount: 2,
    });
    m.startRace();
    // Human 0 (index 0) completes 2 laps first.
    beginLine(m, 0, 3);
    runLap(m, 0, 3);
    runLap(m, 0, 3);
    expect(m.progressOf(0).finished).toBe(true);
    expect(m.leaderLapCount).toBe(2); // leader reached targetLaps...
    expect(m.phase).toBe("racing"); // ...but human 1 has not finished
    // Human 1 (index 1) now completes 2 laps.
    beginLine(m, 1, 3);
    runLap(m, 1, 3);
    runLap(m, 1, 3);
    expect(m.progressOf(1).finished).toBe(true);
    expect(m.phase).toBe("finished");
  });

  it("2P keeps racing past a rival leader finishing (humans still out)", () => {
    const m = new RaceManager({
      kartCount: 3,
      targetLaps: 1,
      finishWhen: "allHumans",
      humanCount: 2,
    });
    m.startRace();
    // Rival (index 2) finishes lap 1.
    beginLine(m, 2, 3);
    runLap(m, 2, 3);
    expect(m.progressOf(2).finished).toBe(true);
    expect(m.leaderLapCount).toBe(1); // a leader crossed the line...
    expect(m.phase).toBe("racing"); // ...but neither human finished
  });

  it("2P finish fires exactly once (update after finished is a no-op)", () => {
    const m = new RaceManager({
      kartCount: 2,
      targetLaps: 1,
      finishWhen: "allHumans",
      humanCount: 2,
    });
    m.startRace();
    beginLine(m, 0, 2);
    runLap(m, 0, 2);
    beginLine(m, 1, 2);
    runLap(m, 1, 2);
    expect(m.phase).toBe("finished");
    const frozen = m.timer;
    m.update(5, [{ t: 0.5 }, { t: 0.5 }]);
    expect(m.phase).toBe("finished");
    expect(m.timer).toBe(frozen);
  });
});
