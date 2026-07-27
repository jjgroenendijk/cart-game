/**
 * Rival-AI field state + helpers (split from FieldBuilder for the file-size
 * cap; behavior unchanged). Mirrors fieldAudioStates.ts: pure data + writes
 * into caller-owned buffers, consumed synchronously each step. Owns the AI
 * tunings/RNG, stuck timers, route plans, per-rival lookahead/avoidance
 * buffers, and the edge-local scratch (aheadPt + gPoseOut).
 */

import type { Terrain } from "../terrain/Terrain";
import type { GraphPose } from "../terrain/trackGraph";
import type { Kart } from "../kart/Kart";
import type { PlayerView } from "./PlayerView";
import { makeRNG, type RNG } from "./rng";
import { wrap01 } from "../race/checkpoints";
import { samplePathAhead, type RoutePlan } from "../race/routing";
import { chooseBranch } from "../race/routeChoice";
import { type AiSplinePoint, type AiRival } from "../race/AiDriver";
import { makeAiTuning } from "../race/aiTuning";

const AI_AHEAD_SAMPLES = 24; // arc-length-even lookahead samples
const AI_AHEAD_METERS = 4; // arc-length step; 24 * 4 = 96 m horizon

/** Per-rival AI tuning (maxSpeed scaled to the chassis in buildRivalAi). */
export type AiTuning = ReturnType<typeof makeAiTuning>;

/**
 * All rival-AI state for one field. Built once per build() from the rival
 * grid + terrain graph; read/written each step by the free helpers below.
 * Buffers are pooled so stepWorld allocates zero objects.
 */
export interface RivalAi {
  tunings: AiTuning[];
  rngs: RNG[];
  stuckAccum: number[];
  /** Per-rival reusable AiSplinePoint[AI_AHEAD_SAMPLES] buffer (pooled). */
  aheadBuf: AiSplinePoint[][];
  /** Per-rival reusable AiRival[] buffer (pooled; length = kartCount - 1). */
  rivalsBuf: AiRival[][];
  /** Per-rival route plans (branch edge id -> take); resolved in build. */
  routePlans: RoutePlan[];
  /** Pooled EdgePoint for AI ahead sampling (reused, no alloc). */
  readonly aheadPt: { x: number; y: number; z: number };
  /** Pooled GraphPose for edge-local AI route sampling (reused, no alloc). */
  readonly gPoseOut: GraphPose;
}

/**
 * Build the per-rival AI state: tunings (maxSpeed pinned to each chassis),
 * RNGs, zeroed stuck timers, route plans (one deterministic branch decision
 * per (rival, branch); personality shapes the odds, the seed pins it), and
 * the pooled lookahead + avoidance buffers. `baseSeed` is the shared AI seed
 * (FieldBuilder keeps AI_BASE_SEED for rival variant/VFX selection too).
 */
export function buildRivalAi(
  rivals: readonly Kart[],
  humanCount: number,
  terrain: Terrain,
  baseSeed: number,
): RivalAi {
  const tunings: AiTuning[] = rivals.map((r, i) => ({
    ...makeAiTuning(baseSeed, i + 1),
    refMaxSpeed: r.controller.tuning.maxSpeed,
  }));
  const rngs: RNG[] = rivals.map((_, i) =>
    makeRNG((baseSeed ^ Math.imul(i + 2, 0x9e3779b1)) >>> 0),
  );
  const stuckAccum: number[] = rivals.map(() => 0);
  // 060: one deterministic route decision per (rival, branch). Personality
  // (aggression) shapes the odds; the seed pins the outcome per world.
  const routePlans: RoutePlan[] = rivals.map((_, i) => {
    const plan = new Map<number, boolean>();
    for (const e of terrain.graph.edges) {
      if (e.closed || (e.kind !== "shortcut" && e.kind !== "scenic")) continue;
      const rng = makeRNG(
        (baseSeed ^ Math.imul(i + 3, 0x85ebca77) ^ Math.imul(e.id + 1, 0x9e3779b1)) >>> 0,
      );
      const windowArc = wrap01(e.tB - e.tA) * terrain.graph.loopLength;
      const info = {
        kind: e.kind,
        halfWidth: e.halfWidthAt(e.length / 2),
        lengthRatio: windowArc > 0 ? e.length / windowArc : 1,
      };
      plan.set(e.id, chooseBranch(info, tunings[i]!, rng));
    }
    return plan;
  });
  // Pool per-rival reusable buffers so stepWorld allocates zero objects.
  const rivalSlotCount = humanCount + rivals.length - 1;
  const aheadBuf: AiSplinePoint[][] = rivals.map(() =>
    Array.from({ length: AI_AHEAD_SAMPLES }, (): AiSplinePoint => ({ x: 0, z: 0, halfWidth: 0 })),
  );
  const rivalsBuf: AiRival[][] = rivals.map(() =>
    Array.from({ length: rivalSlotCount }, (): AiRival => ({ x: 0, z: 0 })),
  );
  return {
    tunings,
    rngs,
    stuckAccum,
    aheadBuf,
    rivalsBuf,
    routePlans,
    aheadPt: { x: 0, y: 0, z: 0 },
    gPoseOut: { edgeId: 0, s: 0, dist: 0, t: 0, halfWidth: 0, pathY: 0 },
  };
}

/**
 * Stuck timer: accumulates sub-step seconds while a rival is slow + off-corridor
 * (past its half-width), resets otherwise. Drives the AI unstuck behavior.
 */
export function tickStuck(
  ai: RivalAi,
  i: number,
  speed: number,
  corridorDist: number,
  halfWidth: number,
  step: number,
): number {
  const tuning = ai.tunings[i]!;
  if (speed < tuning.stuckSpeed && corridorDist > halfWidth) {
    ai.stuckAccum[i] = ai.stuckAccum[i]! + step;
  } else {
    ai.stuckAccum[i] = 0;
  }
  return ai.stuckAccum[i]!;
}

/**
 * Route-following AI horizon (060): edge-local pose via graphPose, then a
 * plan-aware walk (samplePathAhead) that diverts onto taken branches and
 * merges back. Per-station width included (059): AI slows for narrows.
 */
export function sampleAhead(ai: RivalAi, terrain: Terrain, kart: Kart, i: number): AiSplinePoint[] {
  const p = kart.group.position;
  const pose = terrain.graphPose(p.x, p.z, ai.gPoseOut);
  return samplePathAhead(
    terrain.graph,
    ai.routePlans[i],
    pose.edgeId,
    pose.s,
    AI_AHEAD_METERS,
    ai.aheadBuf[i]!,
    ai.aheadPt,
  );
}

/** All other kart positions (humans + other rivals) for AI avoidance. */
export function rivalPositions(
  ai: RivalAi,
  views: readonly PlayerView[],
  rivals: readonly Kart[],
  exclude: number,
  i: number,
): AiRival[] {
  const buf = ai.rivalsBuf[i]!;
  let k = 0;
  for (const v of views) {
    const slot = buf[k]!;
    slot.x = v.kart.group.position.x;
    slot.z = v.kart.group.position.z;
    k++;
  }
  for (let j = 0; j < rivals.length; j++) {
    if (j === exclude) continue;
    const r = rivals[j]!;
    const slot = buf[k]!;
    slot.x = r.group.position.x;
    slot.z = r.group.position.z;
    k++;
  }
  return buf;
}
