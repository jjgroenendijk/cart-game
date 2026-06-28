/**
 * 007 race orchestrator. Owns the race sub-state machine ('grid' | 'racing' |
 * 'finished') + per-kart progress + the race timer + live ranking. Does NOT
 * touch 006's GameState (runs only while Game is 'racing'); Game feeds it kart
 * poses each fixed step.
 *
 * Progress per kart: a LapTracker (cut-proof lap validity, from checkpoints) +
 * cumulative forward arc length (monotonic, wrap-safe) for within-lap ordering.
 * Rank is recomputed each update via raceRanking. The race finishes exactly
 * once when the leader completes the target lap count, then freezes.
 *
 * Pure-ish: no DOM/physics/three deps. Game computes the arc-length t (via
 * SplineTrack.closestPoint) and passes it in as part of the pose, keeping this
 * module jsdom-testable.
 */

import {
  DEFAULT_SECTOR_COUNT,
  LapTracker,
  sectorIndex,
  signedWrapDelta,
  wrap01,
} from "./checkpoints";
import { rank, type RankInput } from "./raceRanking";

/** Default race configuration (007 Defaults). */
export const DEFAULT_TARGET_LAPS = 3;

/** Arc-length gap (loop fraction) at which rubber-band reaches full strength. */
const RUBBER_FULL_GAP = 0.15;

/**
 * Race finish condition. 'leader' (default, 007 behavior) finishes once the
 * leader completes the target laps. 'allHumans' (008 2P) keeps the race alive
 * until every human kart (indices 0..humanCount-1) has finished, so a trailing
 * P2 can complete the race after P1 (or a rival) crosses first.
 */
export type FinishMode = "leader" | "allHumans";

export interface RaceConfig {
  kartCount: number;
  targetLaps?: number;
  sectorCount?: number;
  /** Seed grid t for every kart (behind the start line). */
  gridT?: number;
  rubberBand?: boolean;
  /** When the race finishes. Default 'leader'. */
  finishWhen?: FinishMode;
  /**
   * Number of human karts at the front of the grid (indices 0..humanCount-1).
   * Used only by finishWhen 'allHumans'. Default 1.
   */
  humanCount?: number;
}

export type RacePhase = "grid" | "racing" | "finished";

export interface KartRacePose {
  /** Arc-length param t in [0,1) from SplineTrack.closestPoint. */
  t: number;
  /** Forward speed (m/s); reserved for rubber-band tuning. */
  speed?: number;
}

export interface KartProgress {
  lap: number;
  sectorIdx: number;
  /** Total forward arc length accrued (loop units, monotonic). */
  cumArcLen: number;
  lastT: number;
  /** True once this kart has completed the target laps. */
  finished: boolean;
  /** Race time (s) at which this kart finished, or null. */
  finishTime: number | null;
}

export interface RaceSnapshot {
  phase: RacePhase;
  timer: number;
  leaderLap: number;
  /** positions[index] = 1-based race position (1 = leader). */
  positions: number[];
  /** Kart indices best (1st) to worst. */
  order: number[];
  progress: readonly KartProgress[];
}

export class RaceManager {
  readonly kartCount: number;
  readonly targetLaps: number;
  readonly sectorCount: number;
  readonly finishWhen: FinishMode;
  readonly humanCount: number;
  phase: RacePhase = "grid";
  timer = 0;

  private readonly trackers: LapTracker[];
  private readonly prog: KartProgress[];
  private readonly gridT: number;
  private readonly rubberBand: boolean;
  private positions: number[];
  private order: number[];
  private leaderLap = 0;
  // Reused per-frame snapshot buffer (independent from the internal arrays
  // above) so snapshot() does not allocate. Sized to kartCount at construct.
  private readonly snapPositions: number[];
  private readonly snapOrder: number[];
  private readonly snapProgress: KartProgress[];
  private readonly snap: RaceSnapshot;

  constructor(config: RaceConfig) {
    this.kartCount = config.kartCount;
    this.targetLaps = config.targetLaps ?? DEFAULT_TARGET_LAPS;
    this.sectorCount = config.sectorCount ?? DEFAULT_SECTOR_COUNT;
    this.gridT = wrap01(config.gridT ?? (this.sectorCount - 1) / this.sectorCount);
    this.rubberBand = config.rubberBand ?? true;
    this.finishWhen = config.finishWhen ?? "leader";
    this.humanCount = config.humanCount ?? 1;
    this.trackers = Array.from({ length: this.kartCount }, () => new LapTracker(this.sectorCount));
    this.prog = Array.from({ length: this.kartCount }, () => freshProgress(this.gridT));
    this.positions = this.prog.map((_, i) => i + 1);
    this.order = this.prog.map((_, i) => i);
    this.snapPositions = new Array(this.kartCount).fill(0);
    this.snapOrder = new Array(this.kartCount).fill(0);
    this.snapProgress = Array.from({ length: this.kartCount }, () => freshProgress(this.gridT));
    this.snap = {
      phase: "grid",
      timer: 0,
      leaderLap: 0,
      positions: this.snapPositions,
      order: this.snapOrder,
      progress: this.snapProgress,
    };
  }

  /** Reset all progress + timer and enter 'racing'. Idempotent. */
  startRace(): void {
    this.timer = 0;
    this.leaderLap = 0;
    for (let i = 0; i < this.kartCount; i++) {
      this.trackers[i]!.reset(this.gridT);
      this.prog[i] = freshProgress(this.gridT);
    }
    this.recomputeRank();
    this.phase = "racing";
  }

  /**
   * Advance the race one fixed step. No-op unless 'racing'. Updates the timer,
   * per-kart progress (lap via checkpoints, cumArcLen accrual), recomputes the
   * rank, and fires the finish exactly once when the leader reaches targetLaps.
   */
  update(dt: number, poses: readonly KartRacePose[]): void {
    if (this.phase !== "racing") return;
    this.timer += dt;

    for (let i = 0; i < this.kartCount; i++) {
      const pose = poses[i];
      const p = this.prog[i]!;
      if (!pose) continue;
      const t = wrap01(pose.t);
      const d = signedWrapDelta(p.lastT, t);
      if (d > 0) p.cumArcLen += d;
      const ev = this.trackers[i]!.update(t);
      if (ev.lapCompleted) {
        p.lap = this.trackers[i]!.lap;
        if (!p.finished && p.lap >= this.targetLaps) {
          p.finished = true;
          p.finishTime = this.timer;
        }
      }
      p.sectorIdx = sectorIndex(t, this.sectorCount);
      p.lastT = t;
    }

    this.recomputeRank();
    this.leaderLap = this.prog[this.order[0] ?? 0]?.lap ?? 0;
    if (this.isFinishReached()) {
      this.phase = "finished";
    }
  }

  /**
   * Mode-dependent finish test. 'leader' (default): the leader's lap count
   * reaches targetLaps. 'allHumans' (008 2P): every human index
   * 0..humanCount-1 has the finished flag set. The finished flags are set
   * above during progress accrual, so this reads the just-updated state.
   */
  private isFinishReached(): boolean {
    if (this.finishWhen === "allHumans") {
      for (let i = 0; i < this.humanCount; i++) {
        if (!this.prog[i]!.finished) return false;
      }
      return true;
    }
    return this.leaderLap >= this.targetLaps;
  }

  /** Current 1-based position of kart `index` (1 = leader). */
  positionOf(index: number): number {
    return this.positions[index] ?? 0;
  }

  /** Progress snapshot (lap/sector/cumArcLen/finished) for kart `index`. */
  progressOf(index: number): KartProgress {
    return this.prog[index]!;
  }

  /** Best-to-worst kart index order (frozen once 'finished'). */
  get orderList(): readonly number[] {
    return this.order;
  }

  /** Per-kart positions array (index -> 1-based position). */
  get positionsList(): readonly number[] {
    return this.positions;
  }

  get leaderLapCount(): number {
    return this.leaderLap;
  }

  /**
   * Per-frame snapshot for HUD/minimap/results consumers. Reuses a private
   * buffer: callers MUST read it synchronously before the next snapshot()
   * call overwrites it. The buffer is independent of the manager's internal
   * arrays, so mutating the returned object does not corrupt the manager.
   */
  snapshot(): RaceSnapshot {
    this.snap.phase = this.phase;
    this.snap.timer = this.timer;
    this.snap.leaderLap = this.leaderLap;
    const n = this.kartCount;
    for (let i = 0; i < n; i++) {
      this.snapPositions[i] = this.positions[i]!;
      this.snapOrder[i] = this.order[i]!;
      const src = this.prog[i]!;
      const dst = this.snapProgress[i]!;
      dst.lap = src.lap;
      dst.sectorIdx = src.sectorIdx;
      dst.cumArcLen = src.cumArcLen;
      dst.lastT = src.lastT;
      dst.finished = src.finished;
      dst.finishTime = src.finishTime;
    }
    return this.snap;
  }

  /**
   * Rubber-band speed scale for an AI kart (index > 0), relative to P1 (the
   * classic catch-up band). Rivals trailing P1 get a small boost (up to +0.08);
   * rivals ahead of P1 ease off (down to -0.05). 1.0 = neutral. P1 always
   * returns 1. Continuous in the arc-length gap to P1 and clamped, so it is
   * pure in the race state.
   */
  rubberBandScale(index: number): number {
    if (!this.rubberBand || index <= 0) return 1;
    const me = this.prog[index]!;
    const p1 = this.prog[0]!;
    const gap = p1.cumArcLen - me.cumArcLen; // >0: rival trails P1
    const t = gap / RUBBER_FULL_GAP;
    if (t >= 0) return 1 + 0.08 * Math.min(t, 1);
    return 1 + 0.05 * Math.max(t, -1);
  }

  private recomputeRank(): void {
    const inputs: RankInput[] = this.prog.map((p, i) => ({
      index: i,
      lap: p.lap,
      cumArcLen: p.cumArcLen,
    }));
    const r = rank(inputs);
    this.positions = r.positions;
    this.order = r.order;
  }
}

function freshProgress(gridT: number): KartProgress {
  return {
    lap: 0,
    sectorIdx: sectorIndex(gridT, DEFAULT_SECTOR_COUNT),
    cumArcLen: 0,
    lastT: wrap01(gridT),
    finished: false,
    finishTime: null,
  };
}
