import { describe, expect, it } from "vitest";
import { generateBankProfile, BANK_SLOPE_MAX, type BankGenInput } from "./circuitBank";
import { generateCircuit } from "./circuit";
import { SampleIndex } from "./trackGraph";
import { resolveTrackTraits, DEFAULT_TRACK_TRAITS } from "./trackTraits";

const BANK_MAX = DEFAULT_TRACK_TRAITS.bankMax;

/** Closed circle: radius r, n arc-even samples. */
function circleInput(r: number, n: number): BankGenInput {
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const kappa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    x[i] = r * Math.cos(a);
    z[i] = r * Math.sin(a);
    kappa[i] = 1 / r;
  }
  const length = 2 * Math.PI * r;
  return { x, z, ds: length / n, kappa, length };
}

describe("generateBankProfile — synthetic", () => {
  it("banks a sweeper circle toward the inside, capped at bankMax", () => {
    // Radius 40 circle turning left (+kappa): left is the inside -> bank < 0.
    const p = generateBankProfile(circleInput(40, 300), [], BANK_MAX);
    let peak = 0;
    for (let i = 0; i < p.bank.length; i++) {
      const t = p.s[i]! / (2 * Math.PI * 40);
      expect(Math.abs(p.bank[i]!)).toBeLessThanOrEqual(BANK_MAX + 1e-9);
      if (t > 0.1 && t < 0.85) {
        expect(p.bank[i]!, `station ${i}`).toBeLessThan(0);
        peak = Math.max(peak, Math.abs(p.bank[i]!));
      }
    }
    expect(peak).toBeGreaterThan(0.5 * BANK_MAX);
  });

  it("is level through the start zone with a bounded twist rate", () => {
    const p = generateBankProfile(circleInput(40, 300), [], BANK_MAX);
    const n = p.bank.length;
    const step = (2 * Math.PI * 40) / n;
    for (let i = 0; i < n; i++) {
      const t = p.s[i]! / (2 * Math.PI * 40);
      if (t >= 0.93 || t <= 0.04) expect(p.bank[i]!, `t ${t}`).toBe(0);
      const d = Math.abs(p.bank[(i + 1) % n]! - p.bank[i]!);
      expect(d).toBeLessThanOrEqual(BANK_SLOPE_MAX * step + 1e-9);
    }
  });

  it("levels the corridor around branch anchors", () => {
    const len = 2 * Math.PI * 40;
    const p = generateBankProfile(circleInput(40, 300), [{ tA: 0.3, tB: 0.5 }], BANK_MAX);
    for (let i = 0; i < p.bank.length; i++) {
      const t = p.s[i]! / len;
      const dA = Math.min(Math.abs(t - 0.3), 1 - Math.abs(t - 0.3)) * len;
      const dB = Math.min(Math.abs(t - 0.5), 1 - Math.abs(t - 0.5)) * len;
      if (dA <= 30 || dB <= 30) expect(p.bank[i]!, `t ${t}`).toBe(0);
    }
  });

  it("bankMax <= 0 yields an all-zero profile", () => {
    const p = generateBankProfile(circleInput(40, 300), [], 0);
    expect(p.bank.every((b) => b === 0)).toBe(true);
  });

  it("does not bank straights", () => {
    // Radius 200 circle: curvature far above the 90 m onset radius.
    const p = generateBankProfile(circleInput(200, 600), [], BANK_MAX);
    expect(p.bank.every((b) => b === 0)).toBe(true);
  });
});

describe("generateBankProfile — real circuits", () => {
  it("ships on GeneratedCircuit, deterministic, within the cap", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const c = generateCircuit(seed);
      expect(c.mainBank.s.length).toBeGreaterThan(0);
      for (const b of c.mainBank.bank) {
        expect(Math.abs(b)).toBeLessThanOrEqual(BANK_MAX + 1e-9);
      }
      expect(JSON.stringify(generateCircuit(seed).mainBank)).toBe(JSON.stringify(c.mainBank));
    }
  });

  it("some sweeper circuit actually banks", () => {
    const flow = resolveTrackTraits({
      archetypeWeights: { classic: 0, flow: 1, technical: 0, power: 0 },
    });
    let banked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const c = generateCircuit(seed, flow);
      if (c.mainBank.bank.some((b) => Math.abs(b) > 0.02)) banked++;
    }
    expect(banked).toBeGreaterThanOrEqual(5);
  });

  it("stations XZ-near an arc-far sample stay exactly level (fold legs)", () => {
    const technical = resolveTrackTraits({
      archetypeWeights: { classic: 0, flow: 0, technical: 1, power: 0 },
    });
    for (let seed = 1; seed <= 3; seed++) {
      const c = generateCircuit(seed, technical);
      // Independent re-derivation of the proximity condition from control.
      const pts = c.control;
      const n = pts.length * 8;
      const xs = new Float32Array(n);
      const zs = new Float32Array(n);
      // Dense-enough polyline read of the ring (control points suffice for
      // a conservative check: only flag clearly-near pairs).
      for (let i = 0; i < n; i++) {
        const f = (i / n) * pts.length;
        const i0 = Math.floor(f) % pts.length;
        const i1 = (i0 + 1) % pts.length;
        const u = f - Math.floor(f);
        xs[i] = pts[i0]![0] + (pts[i1]![0] - pts[i0]![0]) * u;
        zs[i] = pts[i0]![2] + (pts[i1]![2] - pts[i0]![2]) * u;
      }
      const idx = new SampleIndex(xs, zs, 16);
      const approxDs = c.length / n;
      for (let i = 0; i < c.mainBank.s.length; i++) {
        const at = Math.round(c.mainBank.s[i]! / approxDs) % n;
        let minDist = Infinity;
        idx.forEachWithin(xs[at]!, zs[at]!, 40, (j, dSq) => {
          const rawGap = Math.abs(j - at) * approxDs;
          const gap = Math.min(rawGap, c.length - rawGap);
          if (gap <= 70) return;
          minDist = Math.min(minDist, Math.sqrt(dSq));
        });
        if (minDist < 18) {
          expect(Math.abs(c.mainBank.bank[i]!), `seed ${seed} station ${i}`).toBeLessThan(1e-9);
        }
      }
    }
  });
});
