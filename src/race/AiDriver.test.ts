import { describe, expect, it } from "vitest";
import { produceInput, type AiPose, type AiSplinePoint, type AiRival } from "./AiDriver";
import { DEFAULT_AI_TUNING, AI_REF_MAX_SPEED, makeAiTuning, withSpeedScale } from "./aiTuning";
import { makeRNG } from "../core/rng";

const TUNING = DEFAULT_AI_TUNING;

function pose(over: Partial<AiPose> = {}): AiPose {
  return {
    pos: { x: 0, z: 0 },
    forward: { x: 0, z: -1 }, // facing -Z (three forward)
    speed: 10,
    corridorDist: 1,
    stuckSeconds: 0,
    ...over,
  };
}

/** Straight spline ahead: N points stepping along -Z from the kart. */
function straightAhead(n: number, step: number): AiSplinePoint[] {
  const out: AiSplinePoint[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: 0, z: -i * step });
  return out;
}

describe("AiDriver — steering toward the lookahead point", () => {
  it("steers ~0 when the path is straight ahead", () => {
    const r = produceInput(pose(), straightAhead(16, 2), [], TUNING, makeRNG(1));
    expect(Math.abs(r.steer)).toBeLessThan(0.25);
  });

  it("steers toward a lookahead point on the kart's left (sign matches physics)", () => {
    // Forward -Z; place the path bending to the -X side (left when facing -Z).
    const ahead: AiSplinePoint[] = [];
    for (let i = 1; i <= 16; i++) ahead.push({ x: -i * 0.5, z: -i * 2 });
    const r = produceInput(pose(), ahead, [], TUNING, makeRNG(1));
    // Positive steer = turn left (+Y angvel) -> toward -X. Path is on -X -> steer > 0.
    expect(r.steer).toBeGreaterThan(0);
  });

  it("steers toward a lookahead point on the kart's right (negative steer)", () => {
    const ahead: AiSplinePoint[] = [];
    for (let i = 1; i <= 16; i++) ahead.push({ x: i * 0.5, z: -i * 2 });
    const r = produceInput(pose(), ahead, [], TUNING, makeRNG(1));
    expect(r.steer).toBeLessThan(0);
  });

  it("steer output is within [-1, 1]", () => {
    const ahead = [{ x: 50, z: -10 }];
    const r = produceInput(pose(), ahead, [], TUNING, makeRNG(1));
    expect(r.steer).toBeGreaterThanOrEqual(-1);
    expect(r.steer).toBeLessThanOrEqual(1);
  });
});

describe("AiDriver — per-rival refMaxSpeed scales lookahead", () => {
  it("a saturated refMaxSpeed aims further ahead on a curve (more steer)", () => {
    // Curve bending increasingly left (-X): further points bear more left, so a
    // longer lookahead (lower refMaxSpeed -> speed01=1) picks a target with a
    // larger left offset -> bigger positive steer.
    const ahead: AiSplinePoint[] = [];
    for (let i = 1; i <= 16; i++) ahead.push({ x: -i * i * 0.05, z: -i * 2 });
    const saturated = { ...TUNING, refMaxSpeed: 30 }; // speed 33 -> speed01=1
    const headroom = { ...TUNING, refMaxSpeed: 60 }; // speed 33 -> speed01=0.55
    const rSat = produceInput(pose({ speed: 33 }), ahead, [], saturated, makeRNG(1));
    const rHead = produceInput(pose({ speed: 33 }), ahead, [], headroom, makeRNG(1));
    expect(rSat.steer).toBeGreaterThan(rHead.steer);
  });
});

describe("AiDriver — throttle eases on curvature", () => {
  it("full throttle on a straight path", () => {
    const r = produceInput(pose(), straightAhead(16, 2), [], TUNING, makeRNG(1));
    expect(r.throttle).toBeGreaterThan(0.85);
  });

  it("eases throttle on a synthetic sharp turn", () => {
    // A hairpin: points turn sharply between the first and second segment.
    const sharp: AiSplinePoint[] = [
      { x: 0, z: -2 },
      { x: 0, z: -4 },
      { x: 4, z: -4 }, // 90-degree bend
      { x: 8, z: -4 },
      { x: 12, z: -4 },
    ];
    const straight = straightAhead(16, 2);
    const rSharp = produceInput(pose(), sharp, [], TUNING, makeRNG(1));
    const rStraight = produceInput(pose(), straight, [], TUNING, makeRNG(1));
    expect(rSharp.throttle).toBeLessThan(rStraight.throttle);
  });

  it("aggressive tuning brakes less than a cautious one", () => {
    const sharp = [
      { x: 0, z: -2 },
      { x: 0, z: -4 },
      { x: 4, z: -4 },
      { x: 8, z: -4 },
      { x: 12, z: -4 },
    ];
    const aggressive = { ...TUNING, aggression: 1.0 };
    const cautious = { ...TUNING, aggression: 0.7 };
    const ra = produceInput(pose(), sharp, [], aggressive, makeRNG(1));
    const rc = produceInput(pose(), sharp, [], cautious, makeRNG(1));
    expect(ra.throttle).toBeGreaterThanOrEqual(rc.throttle);
  });
});

describe("AiDriver — rival avoidance", () => {
  it("adds avoidance steer when a rival is within avoidRadius", () => {
    // Path straight ahead; rival to the right (+X) within radius -> steer left (+).
    const rival: AiRival = { x: 2, z: -2 };
    const noRival = produceInput(pose(), straightAhead(16, 2), [], TUNING, makeRNG(1));
    const withRival = produceInput(pose(), straightAhead(16, 2), [rival], TUNING, makeRNG(1));
    expect(withRival.steer).toBeGreaterThan(noRival.steer);
  });

  it("ignores rivals outside avoidRadius", () => {
    const far: AiRival = { x: 50, z: -2 };
    const noRival = produceInput(pose(), straightAhead(16, 2), [], TUNING, makeRNG(1));
    const withFar = produceInput(pose(), straightAhead(16, 2), [far], TUNING, makeRNG(1));
    expect(Math.abs(withFar.steer - noRival.steer)).toBeLessThan(0.05);
  });
});

describe("AiDriver — stuck recovery", () => {
  it("requests reset when slow + off-corridor for long enough", () => {
    const r = produceInput(
      pose({ speed: 0.5, corridorDist: 8, stuckSeconds: 3 }),
      straightAhead(16, 2),
      [],
      TUNING,
      makeRNG(1),
    );
    expect(r.reset).toBe(true);
    expect(r.throttle).toBe(0);
  });

  it("does NOT reset when slow but still on the corridor", () => {
    const r = produceInput(
      pose({ speed: 0.5, corridorDist: 2, stuckSeconds: 3 }),
      straightAhead(16, 2),
      [],
      TUNING,
      makeRNG(1),
    );
    expect(r.reset).toBe(false);
  });

  it("does NOT reset when off-corridor but moving", () => {
    const r = produceInput(
      pose({ speed: 8, corridorDist: 8, stuckSeconds: 3 }),
      straightAhead(16, 2),
      [],
      TUNING,
      makeRNG(1),
    );
    expect(r.reset).toBe(false);
  });

  it("does NOT reset before stuckTime elapses", () => {
    const r = produceInput(
      pose({ speed: 0.5, corridorDist: 8, stuckSeconds: 0.5 }),
      straightAhead(16, 2),
      [],
      TUNING,
      makeRNG(1),
    );
    expect(r.reset).toBe(false);
  });
});

describe("AiDriver — drift + determinism", () => {
  it("drift is always false (v1)", () => {
    const r = produceInput(pose(), straightAhead(16, 2), [], TUNING, makeRNG(1));
    expect(r.drift).toBe(false);
  });

  it("is deterministic: same seed -> same input sequence", () => {
    const ahead = straightAhead(16, 2);
    const run = (seed: number): { throttle: number; steer: number }[] => {
      const rng = makeRNG(seed);
      return Array.from({ length: 8 }, () => {
        const i = produceInput(pose(), ahead, [], TUNING, rng);
        return { throttle: i.throttle, steer: i.steer };
      });
    };
    expect(run(42)).toEqual(run(42));
    // Different seed -> (very likely) different dither sequence.
    expect(run(42)).not.toEqual(run(7));
  });
});

describe("aiTuning", () => {
  it("makeAiTuning is deterministic for (seed, index)", () => {
    expect(makeAiTuning(123, 0)).toEqual(makeAiTuning(123, 0));
  });

  it("DEFAULT_AI_TUNING.refMaxSpeed mirrors AI_REF_MAX_SPEED (34)", () => {
    expect(DEFAULT_AI_TUNING.refMaxSpeed).toBe(AI_REF_MAX_SPEED);
    expect(DEFAULT_AI_TUNING.refMaxSpeed).toBe(34);
  });

  it("makeAiTuning returns a refMaxSpeed (historical default)", () => {
    expect(makeAiTuning(9, 2).refMaxSpeed).toBe(AI_REF_MAX_SPEED);
  });

  it("makeAiTuning differs across kart indices", () => {
    expect(makeAiTuning(123, 0)).not.toEqual(makeAiTuning(123, 1));
  });

  it("tuning values stay within the 007 Default bands", () => {
    const t = makeAiTuning(2024, 3);
    expect(t.lookaheadNear).toBeGreaterThanOrEqual(5);
    expect(t.lookaheadNear).toBeLessThanOrEqual(7);
    expect(t.lookaheadFar).toBeGreaterThanOrEqual(12);
    expect(t.aggression).toBeGreaterThanOrEqual(0.7);
    expect(t.aggression).toBeLessThanOrEqual(1.0);
    expect(t.maxSpeedScale).toBeGreaterThanOrEqual(0.92);
    expect(t.maxSpeedScale).toBeLessThanOrEqual(1.0);
  });

  it("withSpeedScale multiplies maxSpeedScale (floored)", () => {
    const base = makeAiTuning(5, 1);
    const boosted = withSpeedScale(base, 1.08);
    expect(boosted.maxSpeedScale).toBeCloseTo(base.maxSpeedScale * 1.08, 5);
    const floored = withSpeedScale(base, 0.1);
    expect(floored.maxSpeedScale).toBeGreaterThanOrEqual(0.7);
  });
});
