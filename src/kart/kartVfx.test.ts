import { describe, expect, it } from "vitest";
import { mulberry32 } from "../core/rng";
import {
  EMITTER_PARAMS,
  VFX_BUDGET,
  accumulateSpawns,
  budgetPerKart,
  budgetSplit,
  emissionRate,
  makeRing,
  ringPush,
  ringReset,
  spawnParticle,
  type EmissionInputs,
  type EmitterKind,
} from "./kartVfx";

const inputs = (over: Partial<EmissionInputs> = {}): EmissionInputs => ({
  speed: 0,
  grounded: true,
  isDrifting: false,
  inWater: false,
  ...over,
});

describe("emissionRate", () => {
  describe("dust", () => {
    it("is 0 at/below the 8 m/s threshold even when grounded", () => {
      expect(emissionRate("dust", inputs({ speed: 8 }))).toBe(0);
      expect(emissionRate("dust", inputs({ speed: 0 }))).toBe(0);
    });

    it("is 0 when not grounded regardless of speed", () => {
      expect(emissionRate("dust", inputs({ speed: 30, grounded: false }))).toBe(0);
    });

    it("scales ~linearly above 8: rate(18)==2*rate(13), rate(28)==2*rate(18)", () => {
      const r13 = emissionRate("dust", inputs({ speed: 13 }));
      const r18 = emissionRate("dust", inputs({ speed: 18 }));
      const r28 = emissionRate("dust", inputs({ speed: 28 }));
      expect(r13).toBeGreaterThan(0);
      expect(r18).toBeGreaterThan(r13);
      expect(r18).toBeCloseTo(2 * r13, 6);
      expect(r28).toBeCloseTo(2 * r18, 6);
    });

    it("clamps at a finite max at extreme speed", () => {
      const hi = emissionRate("dust", inputs({ speed: 1000 }));
      const hi2 = emissionRate("dust", inputs({ speed: 2000 }));
      expect(Number.isFinite(hi)).toBe(true);
      expect(hi).toBe(hi2);
    });
  });

  describe("driftSmoke", () => {
    it("is a flat positive rate while drifting && grounded", () => {
      expect(emissionRate("driftSmoke", inputs({ isDrifting: true, speed: 20 }))).toBeGreaterThan(
        0,
      );
    });

    it("is rate-independent of speed (flat)", () => {
      const a = emissionRate("driftSmoke", inputs({ isDrifting: true, speed: 0 }));
      const b = emissionRate("driftSmoke", inputs({ isDrifting: true, speed: 50 }));
      expect(a).toBe(b);
    });

    it("is 0 when not drifting", () => {
      expect(emissionRate("driftSmoke", inputs({ isDrifting: false, speed: 20 }))).toBe(0);
    });

    it("is 0 when drifting but airborne (not grounded)", () => {
      expect(emissionRate("driftSmoke", inputs({ isDrifting: true, grounded: false }))).toBe(0);
    });
  });

  describe("splash", () => {
    it("is a positive continuous rate while inWater", () => {
      expect(emissionRate("splash", inputs({ inWater: true }))).toBeGreaterThan(0);
    });

    it("is 0 when not inWater", () => {
      expect(emissionRate("splash", inputs({ inWater: false }))).toBe(0);
    });

    it("is rate-independent of speed", () => {
      const a = emissionRate("splash", inputs({ inWater: true, speed: 0 }));
      const b = emissionRate("splash", inputs({ inWater: true, speed: 40 }));
      expect(a).toBe(b);
    });
  });

  describe("poof", () => {
    it("is always 0 (burst path; caller uses spawnParticle directly)", () => {
      expect(emissionRate("poof", inputs())).toBe(0);
      expect(emissionRate("poof", inputs({ inWater: true, isDrifting: true, speed: 30 }))).toBe(0);
    });
  });
});

describe("accumulateSpawns", () => {
  it("carries the fractional remainder between frames", () => {
    const st = { remainder: 0 };
    expect(accumulateSpawns(st, 30, 1 / 60)).toBe(0);
    expect(st.remainder).toBeCloseTo(0.5, 6);
    expect(accumulateSpawns(st, 30, 1 / 60)).toBe(1);
    expect(st.remainder).toBeCloseTo(0, 6);
  });

  it("alternates 1,2,1,2 at rate 90 dt 1/60 (deterministic)", () => {
    const st = { remainder: 0 };
    const seq: number[] = [];
    for (let i = 0; i < 4; i++) seq.push(accumulateSpawns(st, 90, 1 / 60));
    expect(seq).toEqual([1, 2, 1, 2]);
    expect(st.remainder).toBeCloseTo(0, 6);
  });

  it("sum of counts over a run ~= rate * total dt (within 1)", () => {
    const st = { remainder: 0 };
    let total = 0;
    const rate = 137;
    for (let i = 0; i < 600; i++) total += accumulateSpawns(st, rate, 1 / 60);
    expect(Math.abs(total - rate * 10)).toBeLessThanOrEqual(1);
  });

  it("is pure: same (rate, dt) sequence from remainder 0 -> same counts", () => {
    const run = (): number[] => {
      const st = { remainder: 0 };
      const out: number[] = [];
      for (let i = 0; i < 10; i++) out.push(accumulateSpawns(st, 47, 1 / 60));
      return out;
    };
    expect(run()).toEqual(run());
  });

  it("clamps remainder >= 0 under a negative rate (no overshoot)", () => {
    const st = { remainder: 0.1 };
    expect(accumulateSpawns(st, -100, 1)).toBe(0);
    expect(st.remainder).toBe(0);
  });
});

describe("RingCursor", () => {
  it("makeRing sets capacity/head/count; clamps capacity < 1 to 1", () => {
    expect(makeRing(3)).toEqual({ capacity: 3, head: 0, count: 0 });
    expect(makeRing(0).capacity).toBe(1);
    expect(makeRing(-4).capacity).toBe(1);
  });

  it("fills 0..N-1 then wraps; count caps at N; oldest overwritten first", () => {
    const cur = makeRing(3);
    expect(ringPush(cur)).toBe(0);
    expect(ringPush(cur)).toBe(1);
    expect(ringPush(cur)).toBe(2);
    expect(cur).toEqual({ capacity: 3, head: 0, count: 3 });
    expect(ringPush(cur)).toBe(0); // oldest slot reused first
    expect(cur).toEqual({ capacity: 3, head: 1, count: 3 });
    expect(ringPush(cur)).toBe(1);
    expect(ringPush(cur)).toBe(2);
    expect(ringPush(cur)).toBe(0);
    expect(cur.count).toBe(3);
  });

  it("after N+M pushes head wraps and count stays at N", () => {
    const cur = makeRing(4);
    for (let i = 0; i < 4 + 7; i++) ringPush(cur);
    expect(cur.count).toBe(4);
    expect(cur.head).toBe((4 + 7) % 4);
  });

  it("ringReset zeroes head + count (capacity retained)", () => {
    const cur = makeRing(5);
    for (let i = 0; i < 9; i++) ringPush(cur);
    ringReset(cur);
    expect(cur).toEqual({ capacity: 5, head: 0, count: 0 });
  });
});

describe("VFX_BUDGET + budgetPerKart + budgetSplit", () => {
  it("VFX_BUDGET totals: low 512, med 1536, high 3072", () => {
    expect(VFX_BUDGET).toEqual({ low: 512, med: 1536, high: 3072 });
  });

  it("budgetPerKart returns the floor of total/kartCount", () => {
    expect(budgetPerKart("low", 1)).toBe(512);
    expect(budgetPerKart("low", 6)).toBe(85);
    expect(budgetPerKart("high", 6)).toBe(512);
    expect(budgetPerKart("med", 4)).toBe(384);
  });

  it("budgetPerKart is 0 when kartCount <= 0", () => {
    expect(budgetPerKart("high", 0)).toBe(0);
    expect(budgetPerKart("low", -3)).toBe(0);
  });

  it("budgetSplit spreads remainder +1 to the first k slots", () => {
    expect(budgetSplit("low", 6)).toEqual([86, 86, 85, 85, 85, 85]);
    expect(budgetSplit("high", 1)).toEqual([3072]);
    expect(budgetSplit("low", 0)).toEqual([]);
  });

  it("budgetSplit sum == VFX_BUDGET[tier] across kart counts", () => {
    for (const tier of ["low", "med", "high"] as const) {
      for (const n of [1, 2, 3, 5, 6, 7, 8]) {
        const sum = budgetSplit(tier, n).reduce((a, b) => a + b, 0);
        expect(sum).toBe(VFX_BUDGET[tier]);
      }
    }
  });
});

describe("EMITTER_PARAMS (look targets)", () => {
  it("dust: life [0.4,0.8], smooth fade", () => {
    expect(EMITTER_PARAMS.dust.life).toEqual([0.4, 0.8]);
    expect(EMITTER_PARAMS.dust.quantizedFadeSteps).toBe(0);
  });

  it("driftSmoke: life [0.8,1.4], grows, smooth fade", () => {
    expect(EMITTER_PARAMS.driftSmoke.life).toEqual([0.8, 1.4]);
    expect(EMITTER_PARAMS.driftSmoke.quantizedFadeSteps).toBe(0);
    expect(EMITTER_PARAMS.driftSmoke.growth).toBeGreaterThan(EMITTER_PARAMS.dust.growth);
  });

  it("all emitters select the smooth fade path", () => {
    for (const params of Object.values(EMITTER_PARAMS)) {
      expect(params.quantizedFadeSteps).toBe(0);
    }
  });
});

describe("spawnParticle", () => {
  const pos = { x: 1, y: 2, z: 3 };

  it("is deterministic: same seed + inputs -> byte-identical particle", () => {
    const a = spawnParticle("dust", pos, 12.5, mulberry32(42));
    const b = spawnParticle("dust", pos, 12.5, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("different seed -> different particle", () => {
    const a = spawnParticle("driftSmoke", pos, 0, mulberry32(1));
    const b = spawnParticle("driftSmoke", pos, 0, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("echoes kind, birth==time, and the spawn pos", () => {
    const p = spawnParticle("splash", pos, 7.25, mulberry32(9));
    expect(p.kind).toBe("splash");
    expect(p.birth).toBe(7.25);
    expect(p.x).toBe(1);
    expect(p.y).toBe(2);
    expect(p.z).toBe(3);
  });

  it("life stays within the kind's [min,max] band", () => {
    const kinds = ["dust", "driftSmoke", "splash", "poof"] as EmitterKind[];
    for (const kind of kinds) {
      const [lo, hi] = EMITTER_PARAMS[kind].life;
      for (let s = 0; s < 50; s++) {
        const p = spawnParticle(kind, pos, 0, mulberry32(s));
        expect(p.life).toBeGreaterThanOrEqual(lo);
        expect(p.life).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("sizeStart + growth + fadeSteps come from the kind params", () => {
    const p = spawnParticle("poof", pos, 0, mulberry32(3));
    const [lo, hi] = EMITTER_PARAMS.poof.size;
    expect(p.sizeStart).toBeGreaterThanOrEqual(lo);
    expect(p.sizeStart).toBeLessThanOrEqual(hi);
    expect(p.growth).toBe(EMITTER_PARAMS.poof.growth);
    expect(p.fadeSteps).toBe(EMITTER_PARAMS.poof.quantizedFadeSteps);
  });

  describe("tint", () => {
    it("dust blends surfaceTint 60% toward white (0.2 -> 0.68 each channel)", () => {
      const p = spawnParticle("dust", pos, 0, mulberry32(5), { r: 0.2, g: 0.2, b: 0.2 });
      expect(p.tintR).toBeCloseTo(0.68, 6);
      expect(p.tintG).toBeCloseTo(0.68, 6);
      expect(p.tintB).toBeCloseTo(0.68, 6);
    });

    it("splash uses the passed surfaceTint verbatim (biome waterColor)", () => {
      const p = spawnParticle("splash", pos, 0, mulberry32(5), { r: 0.3, g: 0.6, b: 0.7 });
      expect(p.tintR).toBeCloseTo(0.3, 6);
      expect(p.tintG).toBeCloseTo(0.6, 6);
      expect(p.tintB).toBeCloseTo(0.7, 6);
    });

    it("driftSmoke ignores surfaceTint (fixed warm white-gray)", () => {
      const a = spawnParticle("driftSmoke", pos, 0, mulberry32(5), { r: 0.1, g: 0.1, b: 0.1 });
      const b = spawnParticle("driftSmoke", pos, 0, mulberry32(5), { r: 0.9, g: 0.9, b: 0.9 });
      expect(a.tintR).toBe(b.tintR);
      expect(a.tintG).toBe(b.tintG);
      expect(a.tintB).toBe(b.tintB);
      expect(a.tintR).toBeGreaterThanOrEqual(a.tintG);
      expect(a.tintG).toBeGreaterThanOrEqual(a.tintB);
      expect(a.tintR).toBeGreaterThan(0.5);
    });

    it("poof ignores surfaceTint (fixed warm white)", () => {
      const withTint = spawnParticle("poof", pos, 0, mulberry32(5), { r: 0.1, g: 0.1, b: 0.1 });
      const noTint = spawnParticle("poof", pos, 0, mulberry32(5), undefined);
      expect(withTint.tintR).toBe(noTint.tintR);
      expect(noTint.tintR).toBeGreaterThan(0.8);
    });
  });

  it("vy is rise-scaled; vx/vz form an outward fan in XZ", () => {
    const p = spawnParticle("splash", pos, 0, mulberry32(11));
    const rise = EMITTER_PARAMS.splash.rise;
    expect(p.vy).toBeGreaterThanOrEqual(rise * 0.7 - 1e-9);
    expect(p.vy).toBeLessThanOrEqual(rise * 1.3 + 1e-9);
    const horiz = Math.hypot(p.vx, p.vz);
    const [lo, hi] = EMITTER_PARAMS.splash.speed;
    expect(horiz).toBeGreaterThanOrEqual(lo);
    expect(horiz).toBeLessThanOrEqual(hi);
  });
});
