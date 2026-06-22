/**
 * 007 checkpoint progress + lap validity. Pure (no DOM, no physics, no three
 * deps) so it runs under jsdom. The race path is a closed loop parametrized by
 * arc-length t in [0,1); the seam at t=0 is the start/finish line.
 *
 * Lap model (cut-proof): the loop is split into K ordered sectors. A lap counts
 * only when the kart crosses the start line forward AFTER entering every
 * intermediate sector (1..K-1) in order since the last line crossing. Skipping a
 * sector or crossing the line early invalidates the current lap (resets the
 * gate chain). Reversing awards nothing. The chain is anchored to the start
 * line, so grid spawns behind the line (sector K-1) begin cleanly on the first
 * forward line crossing.
 */

/** Ordered sector count around the loop (007 Defaults). */
export const DEFAULT_SECTOR_COUNT = 6;

/**
 * Max wrap-aware delta (fraction of the loop) accepted as a normal single-step
 * move. Beyond it is a teleport/cut. A kart at ~34 m/s on a ~377 m loop moves
 * ~0.002/frame, so 0.34 is a generous ceiling (~128x the real max).
 */
const FORWARD_CUT = 0.34;
const BACKWARD_CUT = 0.34;

/** Wrap a loop parameter into [0,1). */
export function wrap01(t: number): number {
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

/**
 * Signed shortest delta from prev to curr on the loop, in (-0.5, 0.5]. Positive
 * = forward, negative = backward. Handles the [0,1) seam.
 */
export function signedWrapDelta(prev: number, curr: number): number {
  let d = wrap01(curr) - wrap01(prev);
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  return d;
}

/** Sector index (0..k-1) for a loop parameter. */
export function sectorIndex(t: number, k: number): number {
  const ti = wrap01(t) * k;
  const i = Math.floor(ti);
  return i >= k ? k - 1 : i < 0 ? 0 : i;
}

/** Boundary parameters t = i/k for i in 0..k-1 (start/finish is index 0). */
export function buildSectorBoundaries(k: number = DEFAULT_SECTOR_COUNT): number[] {
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(i / k);
  return out;
}

export interface TrackProgress {
  /** Wrap-aware forward delta; negative = backward move. */
  forwardDelta: number;
  /** Sector (0..k-1) at prevT. */
  prevSector: number;
  /** Sector (0..k-1) at currT. */
  sector: number;
}

/** Wrap-aware per-step progress between two loop params. Pure. */
export function trackProgress(prevT: number, currT: number, k: number): TrackProgress {
  return {
    forwardDelta: signedWrapDelta(prevT, currT),
    prevSector: sectorIndex(prevT, k),
    sector: sectorIndex(currT, k),
  };
}

export interface LapState {
  lap: number;
  /**
   * Next sector gate the kart must enter forward to advance the chain. 0 means
   * "not yet begun this lap" (awaiting the first start-line crossing). 1..K-1
   * are intermediate gates; reaching K means all gates are down and the next
   * line crossing completes the lap.
   */
  nextGate: number;
  /** Last observed sector (for edge detection). */
  lastSector: number;
  /** Last observed loop parameter (for delta/teleport detection). */
  lastT: number;
  /** Whether the tracker has seen its first update. */
  primed: boolean;
}

/** Fresh lap state anchored behind the start line (sector K-1). */
export function initialLapState(
  t: number = (DEFAULT_SECTOR_COUNT - 1) / DEFAULT_SECTOR_COUNT,
  k: number = DEFAULT_SECTOR_COUNT,
): LapState {
  return { lap: 0, nextGate: 0, lastSector: sectorIndex(t, k), lastT: wrap01(t), primed: false };
}

export interface LapEvent {
  /** Updated state (feed back in on the next update). */
  state: LapState;
  /** True the step a lap is awarded (fires once per lap). */
  lapCompleted: boolean;
  /** True when a cut/skip/early-cross invalidates the current lap. */
  cut: boolean;
}

/**
 * Advance lap validity one step. Pure: takes state + currT, returns the next
 * state and any lap/cut event. Anchors a lap to a forward start-line crossing
 * (sector K-1 -> sector 0) following an ordered pass through gates 1..K-1.
 *
 * Rules:
 * - backward move: awards nothing, chain unchanged.
 * - forward entry into the expected next gate: advances the chain.
 * - skip (forward entry into a sector past nextGate): cut, chain reset.
 * - forward line crossing with all gates down: lap++, chain restart.
 * - forward line crossing early (gates missing): cut, chain reset.
 * - teleport (|delta| beyond the cut band): cut, chain reset.
 */
export function advanceLap(
  state: LapState,
  currT: number,
  k: number = DEFAULT_SECTOR_COUNT,
): LapEvent {
  const wrapped = wrap01(currT);
  if (!state.primed) {
    return {
      state: { ...state, lastSector: sectorIndex(wrapped, k), lastT: wrapped, primed: true },
      lapCompleted: false,
      cut: false,
    };
  }

  const prevSector = state.lastSector;
  const sector = sectorIndex(wrapped, k);
  const delta = signedWrapDelta(state.lastT, wrapped);
  const base: LapState = { ...state, lastSector: sector, lastT: wrapped };

  // Teleport guard: an impossibly large jump either direction is a cut.
  if (delta > FORWARD_CUT || delta < -BACKWARD_CUT) {
    return { state: { ...base, nextGate: 0 }, lapCompleted: false, cut: true };
  }

  // No sector change: nothing to award regardless of tiny drift.
  if (sector === prevSector) {
    return { state: base, lapCompleted: false, cut: false };
  }

  // Backward sector change: awards nothing, chain unchanged.
  if (delta <= 0) {
    return { state: base, lapCompleted: false, cut: false };
  }

  // Forward sector change.
  const crossedLine = prevSector === k - 1 && sector === 0;

  if (crossedLine) {
    if (state.nextGate === 0) {
      return { state: { ...base, nextGate: 1 }, lapCompleted: false, cut: false };
    }
    if (state.nextGate >= k) {
      return {
        state: { ...base, lap: state.lap + 1, nextGate: 1 },
        lapCompleted: true,
        cut: false,
      };
    }
    return { state: { ...base, nextGate: 0 }, lapCompleted: false, cut: true };
  }

  if (state.nextGate === 0) {
    return { state: base, lapCompleted: false, cut: false };
  }
  if (sector === state.nextGate) {
    return { state: { ...base, nextGate: state.nextGate + 1 }, lapCompleted: false, cut: false };
  }
  if (sector > state.nextGate && sector <= k - 1) {
    return { state: { ...base, nextGate: 0 }, lapCompleted: false, cut: true };
  }
  return { state: base, lapCompleted: false, cut: false };
}

/**
 * Deterministic lap tracker wrapping advanceLap. Holds per-kart state so
 * raceManager stays terse. Pure logic; no side effects.
 */
export class LapTracker {
  readonly sectorCount: number;
  private s: LapState;

  constructor(sectorCount: number = DEFAULT_SECTOR_COUNT) {
    this.sectorCount = sectorCount;
    this.s = initialLapState((sectorCount - 1) / sectorCount, sectorCount);
  }

  get lap(): number {
    return this.s.lap;
  }

  get nextGate(): number {
    return this.s.nextGate;
  }

  /** Reset to a fresh chain anchored behind the start line at t. */
  reset(t: number = (this.sectorCount - 1) / this.sectorCount): void {
    this.s = { ...initialLapState(t, this.sectorCount), primed: true };
  }

  /** Advance one step; returns whether a lap completed and/or a cut fired. */
  update(currT: number): { lapCompleted: boolean; cut: boolean } {
    const r = advanceLap(this.s, currT, this.sectorCount);
    this.s = r.state;
    return { lapCompleted: r.lapCompleted, cut: r.cut };
  }
}
