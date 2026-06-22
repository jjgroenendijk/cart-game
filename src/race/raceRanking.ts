/**
 * 007 race ranking. Pure + deterministic (no DOM/physics/three) so it runs under
 * jsdom. Ranks N karts lexicographically by (lap desc, cumArcLen desc): a kart
 * that has completed more laps leads; within a lap, the one further along the
 * spline (greater cumulative arc length) leads. Exact ties break by kart index
 * ascending so the order is stable and reproducible.
 */

/** Per-kart progress fed to the ranker. */
export interface RankInput {
  /** Stable kart identifier (0..N-1); also the tie-break key. */
  index: number;
  /** Completed laps (from checkpoints). */
  lap: number;
  /** Cumulative forward arc length in loop units (monotonic). */
  cumArcLen: number;
}

export interface RankResult {
  /** positions[index] = 1-based race position (1 = leader, N = last). */
  positions: number[];
  /** Kart indices ordered best (1st) to worst (Nth). */
  order: number[];
}

/**
 * Rank karts by (lap, cumArcLen), best first. Deterministic: identical inputs
 * always yield identical output. O(N log N).
 */
export function rank(inputs: RankInput[]): RankResult {
  const tagged = inputs.map((p) => ({ p, key: p.lap * 1e9 + p.cumArcLen }));
  // Descending by key; ties broken by ascending index for stability.
  tagged.sort((a, b) => {
    if (a.key !== b.key) return b.key - a.key;
    return a.p.index - b.p.index;
  });

  const n = inputs.length;
  const positions = new Array<number>(n).fill(0);
  const order: number[] = [];
  for (let pos = 0; pos < n; pos++) {
    const idx = tagged[pos]!.p.index;
    positions[idx] = pos + 1;
    order.push(idx);
  }
  return { positions, order };
}

/**
 * Lexicographic comparison helper: >0 if a leads b, <0 if b leads a, 0 tied.
 * Exposed for raceManager/tests so the ordering key is testable in isolation.
 */
export function compareProgress(a: RankInput, b: RankInput): number {
  if (a.lap !== b.lap) return a.lap - b.lap;
  if (a.cumArcLen !== b.cumArcLen) return a.cumArcLen - b.cumArcLen;
  return b.index - a.index;
}
