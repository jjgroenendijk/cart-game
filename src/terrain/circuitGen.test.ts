import { describe, expect, it } from "vitest";
import {
  buildAttempt,
  generateCircuit,
  tamedOpts,
  validateCircuit,
  FALLBACK_SEED,
  ROAD_WATER_CLEARANCE,
  type CircuitAnalysis,
} from "./circuit";
import { archetypeOpts, drawArchetype } from "./circuitArchetype";
import { resolveTrackTraits, ARCHETYPES, type LayoutArchetype } from "./trackTraits";
import { BIOMES } from "../biomes/registry";

const SEEDS = 5000;
const LEN_MIN = 588;
const LEN_MAX = 1530;
const WORLD_CAP = 768;

describe("generateCircuit — 5000-seed validity sweep", () => {
  it("every seed: valid, length, worldSize, extent; shape floors hold", () => {
    let minRadius = Infinity;
    let minSepNear = Infinity;
    let minSepFar = Infinity;
    let maxWorld = 0;
    let maxGrade = 0;
    const spans: number[] = [];
    const analyses: CircuitAnalysis[] = [];
    const groups = new Map<LayoutArchetype, CircuitAnalysis[]>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const c = generateCircuit(seed);
      const v = validateCircuit(c.control);
      const group = groups.get(c.archetype) ?? [];
      group.push(v);
      groups.set(c.archetype, group);
      // Drivability: radius >= 12.5, no self-intersection, tiered separation.
      expect(v.ok, `seed ${seed} invalid: ${JSON.stringify(v)}`).toBe(true);
      // Pitch: the accept gate caps sampled grade at 0.18 (0.14 on the ring).
      expect(v.maxGrade, `seed ${seed} maxGrade ${v.maxGrade}`).toBeLessThanOrEqual(0.18);
      let yLo = Infinity;
      let yHi = -Infinity;
      for (const p of c.control) {
        if (p[1] < yLo) yLo = p[1];
        if (p[1] > yHi) yHi = p[1];
      }
      spans.push(yHi - yLo);
      maxGrade = Math.max(maxGrade, v.maxGrade);
      // Length within 600-1500 m +-2% (588..1530).
      expect(c.length, `seed ${seed} length ${c.length}`).toBeGreaterThanOrEqual(LEN_MIN);
      expect(c.length, `seed ${seed} length ${c.length}`).toBeLessThanOrEqual(LEN_MAX);
      // Fits the world cap.
      expect(c.worldSize, `seed ${seed} worldSize ${c.worldSize}`).toBeLessThanOrEqual(
        WORLD_CAP + 1e-6,
      );
      // Every control point within the centered bbox (+/- worldSize/2).
      const half = c.worldSize / 2;
      for (const p of c.control) {
        expect(Math.abs(p[0]), `seed ${seed} ctrl x`).toBeLessThanOrEqual(half + 1e-6);
        expect(Math.abs(p[2]), `seed ${seed} ctrl z`).toBeLessThanOrEqual(half + 1e-6);
      }
      analyses.push(v);
      minRadius = Math.min(minRadius, v.minRadius);
      minSepNear = Math.min(minSepNear, v.sepNear);
      minSepFar = Math.min(minSepFar, v.sepFar);
      maxWorld = Math.max(maxWorld, c.worldSize);
    }
    expect(minRadius).toBeGreaterThanOrEqual(12.5);
    expect(minSepNear).toBeGreaterThanOrEqual(18);
    expect(minSepFar).toBeGreaterThanOrEqual(30);
    expect(maxWorld).toBeLessThanOrEqual(WORLD_CAP);
    expect(maxGrade).toBeLessThanOrEqual(0.18);
    // Elevation reads as hills AND varies per seed: most laps climb >= 8 m,
    // a real cohort of mountain seeds climbs >= 14 m, and a real cohort of
    // calm seeds stays <= 7 m. Measured on this build (800-seed calibration):
    // span8 89%, span14 43%, spanLe7 7%.
    expect(spans.filter((s) => s >= 8).length / SEEDS).toBeGreaterThanOrEqual(0.8);
    expect(spans.filter((s) => s >= 14).length / SEEDS).toBeGreaterThanOrEqual(0.3);
    expect(spans.filter((s) => s <= 7).length / SEEDS).toBeGreaterThanOrEqual(0.03);

    // Shape-quality floors, per archetype (084): each personality is held
    // to its own signature so the generator can neither regress to ovals
    // nor blur the archetypes together. Measured on this build (1500-seed
    // calibration): classic hp 85%/sb2 78%/c6 80%; flow sb2 98%/c6 98%;
    // technical hp 93%/sb2 82%/c8 72%; power hp 98%/st120 92%/st150 90%;
    // c8 over all cohorts 58%.
    const frac = (vs: CircuitAnalysis[], f: (v: CircuitAnalysis) => boolean): number =>
      vs.filter(f).length / vs.length;
    for (const a of ARCHETYPES) {
      // Technical-leaning weights, but every archetype keeps a real cohort.
      expect(groups.get(a)?.length ?? 0, `archetype ${a} cohort`).toBeGreaterThanOrEqual(
        SEEDS * 0.13,
      );
    }
    // Global corner density: most laps pack >= 8 corners regardless of
    // archetype (power's straight-heavy cohort is the only sparse one).
    expect(frac(analyses, (v) => v.cornerCount >= 8)).toBeGreaterThanOrEqual(0.5);
    const classic = groups.get("classic")!;
    expect(frac(classic, (v) => v.hairpins >= 1)).toBeGreaterThanOrEqual(0.78);
    expect(frac(classic, (v) => v.sBends >= 2)).toBeGreaterThanOrEqual(0.65);
    expect(frac(classic, (v) => v.cornerCount >= 6)).toBeGreaterThanOrEqual(0.7);
    expect(frac(classic, (v) => v.longestStraight >= 60)).toBeGreaterThanOrEqual(0.7);
    const flow = groups.get("flow")!;
    expect(frac(flow, (v) => v.sBends >= 2)).toBeGreaterThanOrEqual(0.9);
    expect(frac(flow, (v) => v.cornerCount >= 6)).toBeGreaterThanOrEqual(0.9);
    const technical = groups.get("technical")!;
    expect(frac(technical, (v) => v.hairpins >= 1)).toBeGreaterThanOrEqual(0.85);
    expect(frac(technical, (v) => v.sBends >= 2)).toBeGreaterThanOrEqual(0.7);
    expect(frac(technical, (v) => v.cornerCount >= 8)).toBeGreaterThanOrEqual(0.6);
    const power = groups.get("power")!;
    expect(frac(power, (v) => v.hairpins >= 1)).toBeGreaterThanOrEqual(0.95);
    expect(frac(power, (v) => v.longestStraight >= 120)).toBeGreaterThanOrEqual(0.85);
    expect(frac(power, (v) => v.longestStraight >= 150)).toBeGreaterThanOrEqual(0.8);
    const median = (vs: CircuitAnalysis[]): number =>
      vs.map((v) => v.cornerCount).sort((x, y) => x - y)[vs.length >> 1]!;
    // Power laps are corner-sparse relative to technical ones.
    expect(median(power)).toBeLessThan(median(technical));
    // ~50 s standalone; generous timeout for parallel-suite contention.
  }, 180000);
});

describe("generateCircuit — fallback", () => {
  it("the fallback draw is valid AND interesting (termination guarantee)", () => {
    // generateCircuit returns buildAttempt(FALLBACK_SEED, 0, tamedOpts(0))
    // when every attempt fails; this asserts that exact draw stays valid so
    // every seed is guaranteed to terminate with a drivable loop.
    const plan = buildAttempt(FALLBACK_SEED, 0, tamedOpts(0));
    const v = validateCircuit(plan.control);
    expect(v.ok).toBe(true);
    expect(v.length).toBeGreaterThanOrEqual(LEN_MIN);
    expect(v.length).toBeLessThanOrEqual(LEN_MAX);
    expect(plan.worldSize).toBeLessThanOrEqual(WORLD_CAP);
    expect(v.hairpins).toBeGreaterThanOrEqual(1);
    expect(v.cornerCount).toBeGreaterThanOrEqual(6);
  });
});

describe("layout archetypes (084)", () => {
  it("archetypeOpts('classic', t) reproduces tamedOpts(t) draws bit-for-bit", () => {
    // The classic base and the default-knob recipe (tamedOpts + buildMainline
    // defaults, also the fallback path) must stay draw-for-draw identical.
    for (const t of [0, 0.25, 5 / 11, 0.75, 1]) {
      for (let seed = 0; seed < 20; seed++) {
        const legacy = buildAttempt(seed, 0, tamedOpts(t));
        const classic = buildAttempt(seed, 0, archetypeOpts("classic", t));
        expect(JSON.stringify(classic)).toBe(JSON.stringify(legacy));
      }
    }
  });

  it("drawArchetype is deterministic and matches the shipped circuit", () => {
    for (let seed = 0; seed < 200; seed++) {
      const a = drawArchetype(seed);
      expect(drawArchetype(seed)).toBe(a);
      const c = generateCircuit(seed);
      // The fallback path ships the classic recipe regardless of the draw.
      if (c.archetype !== a) expect(c.archetype).toBe("classic");
    }
  });

  it("trait weights bias the draw; all-zero falls back to equal", () => {
    const onlyTech = resolveTrackTraits({ archetypeWeights: { classic: 0, flow: 0, power: 0 } });
    for (let seed = 0; seed < 300; seed++) {
      expect(drawArchetype(seed, onlyTech)).toBe("technical");
    }
    const zeroed = resolveTrackTraits({
      archetypeWeights: { classic: 0, flow: 0, technical: 0, power: 0 },
    });
    const seen = new Set(Array.from({ length: 300 }, (_, s) => drawArchetype(s, zeroed)));
    expect(seen.size).toBeGreaterThan(1); // equal-weight fallback, not stuck
  });

  it("every archetype produces valid deterministic circuits when forced", () => {
    for (const a of ARCHETYPES) {
      const traits = resolveTrackTraits({
        archetypeWeights: { classic: 0, flow: 0, technical: 0, power: 0, [a]: 1 },
      });
      for (let seed = 0; seed < 30; seed++) {
        const c = generateCircuit(seed, traits);
        const v = validateCircuit(c.control);
        expect(v.ok, `${a} seed ${seed}`).toBe(true);
        expect(JSON.stringify(generateCircuit(seed, traits))).toBe(JSON.stringify(c));
      }
    }
  });
});

describe("biome track character (084)", () => {
  it("biome archetype weights bias the draw (alpine technical, desert power)", () => {
    const alpine = resolveTrackTraits(BIOMES["alpine"]!.track);
    const desert = resolveTrackTraits(BIOMES["desert"]!.track);
    const tally = (traits: ReturnType<typeof resolveTrackTraits>): Map<string, number> => {
      const m = new Map<string, number>();
      for (let seed = 0; seed < 400; seed++) {
        const a = drawArchetype(seed, traits);
        m.set(a, (m.get(a) ?? 0) + 1);
      }
      return m;
    };
    const alp = tally(alpine);
    expect(alp.get("power") ?? 0).toBe(0); // weight 0 -> never drawn
    expect(alp.get("technical") ?? 0).toBeGreaterThan(alp.get("classic") ?? 0);
    const des = tally(desert);
    expect(des.get("power") ?? 0).toBeGreaterThan(des.get("classic") ?? 0);
    expect(des.get("power") ?? 0).toBeGreaterThan(des.get("technical") ?? 0);
  });

  it("elevationScale shapes the lap: alpine climbs, desert stays calm", () => {
    const alpine = resolveTrackTraits(BIOMES["alpine"]!.track);
    const desert = resolveTrackTraits(BIOMES["desert"]!.track);
    const meanSpan = (traits: ReturnType<typeof resolveTrackTraits>): number => {
      let acc = 0;
      const n = 30;
      for (let seed = 0; seed < n; seed++) {
        const c = generateCircuit(seed, traits);
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of c.control) {
          if (p[1] < lo) lo = p[1];
          if (p[1] > hi) hi = p[1];
        }
        acc += hi - lo;
      }
      return acc / n;
    };
    expect(meanSpan(alpine)).toBeGreaterThan(meanSpan(desert) * 1.5);
  });
});

describe("generateCircuit — determinism", () => {
  it("same seed reproduces bit-identical control + worldSize + length", () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = generateCircuit(seed);
      const b = generateCircuit(seed);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("different seeds differ (the generator is actually seed-driven)", () => {
    const a = generateCircuit(1);
    const b = generateCircuit(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("generateCircuit — water clearance", () => {
  it("every control Y >= waterLevel + clearance when waterLevel is given", () => {
    const wl = -2;
    const floor = wl + ROAD_WATER_CLEARANCE;
    for (let seed = 0; seed < 300; seed++) {
      const c = generateCircuit(seed, undefined, wl);
      for (const p of c.control) {
        expect(p[1]).toBeGreaterThanOrEqual(floor - 1e-6);
      }
    }
  });

  it("waterLevel undefined leaves valleys unconstrained (negatives appear)", () => {
    let minY = Infinity;
    for (let seed = 0; seed < 300; seed++) {
      const c = generateCircuit(seed);
      for (const p of c.control) minY = Math.min(minY, p[1]);
    }
    // The raw zero-mean profile reliably dips below the tropical floor (-0.5).
    expect(minY).toBeLessThan(-0.5);
  });

  it("water clearance does not break validity or determinism", () => {
    const wl = -2;
    for (let seed = 0; seed < 50; seed++) {
      const a = generateCircuit(seed, undefined, wl);
      const b = generateCircuit(seed, undefined, wl);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const v = validateCircuit(a.control);
      expect(v.ok).toBe(true);
    }
  });
});
