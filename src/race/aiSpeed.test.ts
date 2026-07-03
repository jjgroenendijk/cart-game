import { describe, expect, it } from "vitest";
import { allowedSpeed } from "./aiSpeed";
import type { AiSplinePoint } from "./AiDriver";
import { DEFAULT_AI_TUNING } from "./aiTuning";

const TUNING = DEFAULT_AI_TUNING;

/** Collinear straight-ahead points stepping along -Z. */
function straightAhead(n: number, step: number): AiSplinePoint[] {
  const out: AiSplinePoint[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: 0, z: -i * step });
  return out;
}

/** Tight hairpin: 90-degree bend with a genuinely small Menger radius. */
function hairpinAhead(): AiSplinePoint[] {
  return [
    { x: 0, z: -2 },
    { x: 0, z: -4 },
    { x: 4, z: -4 }, // 90-degree bend, R ~ 2.2 m
    { x: 8, z: -4 },
    { x: 12, z: -4 },
  ];
}

describe("allowedSpeed — 056 braking-distance model", () => {
  it("returns Infinity on a straight (collinear) path", () => {
    expect(allowedSpeed(straightAhead(16, 2), TUNING, 6)).toBe(Infinity);
  });

  it("returns a finite, low speed on a tight hairpin (< 12 m/s)", () => {
    const v = allowedSpeed(hairpinAhead(), TUNING, 6);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeLessThan(12);
  });

  it("hairpin speed is lower than straight speed", () => {
    const vSharp = allowedSpeed(hairpinAhead(), TUNING, 6);
    const vStraight = allowedSpeed(straightAhead(16, 2), TUNING, 6);
    expect(vSharp).toBeLessThan(vStraight);
  });

  it("narrower halfWidth lowers allowedSpeed (halfWidth 3 < halfWidth 6)", () => {
    const ahead = hairpinAhead();
    const v6 = allowedSpeed(ahead, TUNING, 6);
    const v3 = allowedSpeed(ahead, TUNING, 3);
    expect(v3).toBeLessThan(v6);
  });

  it("higher aggression raises allowedSpeed (1.0 > 0.7)", () => {
    const ahead = hairpinAhead();
    const aggressive = { ...TUNING, aggression: 1.0 };
    const cautious = { ...TUNING, aggression: 0.7 };
    const vAggr = allowedSpeed(ahead, aggressive, 6);
    const vCaut = allowedSpeed(ahead, cautious, 6);
    expect(vAggr).toBeGreaterThan(vCaut);
  });

  it("a near corner yields lower speed than the same corner placed far", () => {
    // Identical bend geometry (ab=2 vertical, bc=4 horizontal, R ~ 2.2 m).
    const near: AiSplinePoint[] = [
      { x: 0, z: -2 },
      { x: 0, z: -4 }, // bend here, d ~ 2 m from ahead[0]
      { x: 4, z: -4 },
      { x: 8, z: -4 },
      { x: 12, z: -4 },
    ];
    const far: AiSplinePoint[] = [
      { x: 0, z: 0 },
      { x: 0, z: -2 },
      { x: 0, z: -4 }, // straight padding
      { x: 0, z: -6 }, // bend here, d ~ 6 m from ahead[0]
      { x: 4, z: -6 },
      { x: 8, z: -6 },
      { x: 12, z: -6 },
    ];
    const vNear = allowedSpeed(near, TUNING, 6);
    const vFar = allowedSpeed(far, TUNING, 6);
    expect(vNear).toBeLessThan(vFar);
  });
});
