/**
 * 009 impact routing. Pure de-duplication + throttling that turns a batch of
 * Rapier contact-force events into at most one sound per kart per fixed step.
 *
 * Game drains the EventQueue (it owns physics/Rapier) into plain RawImpact
 * rows, then hands them here alongside a colliderHandle->kartIndex map and a
 * per-kart last-fire timestamp. routeImpacts drops sub-threshold taps, keeps
 * the strongest force per kart, suppresses any kart still inside its cooldown,
 * and returns the hits + the advanced timestamp array. AudioManager just plays
 * each hit's force — it never sees kart indices, cooldowns, or Rapier types.
 *
 * Pure: no Web Audio, no Rapier, no side effects. Fully unit tested.
 */

export interface RawImpact {
  /** Collider handle from TempContactForceEvent.collider1(). */
  collider1: number;
  /** Collider handle from TempContactForceEvent.collider2(). */
  collider2: number;
  /** Sum of contact-force magnitudes (TempContactForceEvent.totalForceMagnitude). */
  force: number;
}

export interface RoutedHit {
  /** Kart index the hit belongs to (from the handle map). */
  index: number;
  /** Strongest qualifying force for this kart this step (N). */
  force: number;
}

export interface ImpactRouteOptions {
  /** Minimum totalForceMagnitude to count as a hit (drops brush contacts). */
  threshold: number;
  /** Per-kart cooldown (s): a kart cannot fire again until this elapses. */
  cooldown: number;
}

export const DEFAULT_IMPACT_ROUTE: ImpactRouteOptions = {
  threshold: 300,
  cooldown: 0.08,
};

/**
 * Route a step's worth of contact-force events into throttled per-kart hits.
 *
 * - Resolves each event's two collider handles to kart indices via `handleMap`
 *   (either side may be the kart; kart-kart hits both). Events between two
 *   non-karts (e.g. prop-prop) contribute nothing.
 * - Skips forces below `threshold`.
 * - Suppresses a kart still inside its `cooldown` since `lastImpactAt[index]`.
 * - When a kart qualifies from multiple events in one step, keeps the max force.
 *
 * Returns the hits (one per qualifying kart, ascending index) and a NEW
 * lastImpactAt array with each fired kart stamped at `now`. The input array is
 * not mutated.
 */
export function routeImpacts(
  events: readonly RawImpact[],
  handleMap: ReadonlyMap<number, number>,
  lastImpactAt: readonly number[],
  now: number,
  opts: ImpactRouteOptions = DEFAULT_IMPACT_ROUTE,
): { hits: RoutedHit[]; lastImpactAt: number[] } {
  // Strongest qualifying force per kart this step.
  const maxForce = new Map<number, number>();
  for (const ev of events) {
    if (ev.force < opts.threshold) continue;
    for (const handle of [ev.collider1, ev.collider2]) {
      const index = handleMap.get(handle);
      if (index === undefined) continue;
      const prev = maxForce.get(index);
      if (prev === undefined || ev.force > prev) maxForce.set(index, ev.force);
    }
  }

  const hits: RoutedHit[] = [];
  const next = lastImpactAt.slice();
  for (const index of [...maxForce.keys()].sort((a, b) => a - b)) {
    const last = lastImpactAt[index] ?? -Infinity;
    if (now - last < opts.cooldown) continue; // still inside per-kart cooldown
    const force = maxForce.get(index)!;
    hits.push({ index, force });
    next[index] = now;
  }
  return { hits, lastImpactAt: next };
}
