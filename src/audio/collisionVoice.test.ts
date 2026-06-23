import { describe, expect, it } from "vitest";
import { MockGain, MockAudioContext } from "./mockAudioContext";
import { makeNoiseBuffer } from "./noiseBuffer";
import {
  CollisionVoice,
  impactTier,
  DEFAULT_IMPACT,
  type ImpactTierOptions,
} from "./collisionVoice";

type Ctx = MockAudioContext;

function makeVoice(opts?: ImpactTierOptions): { ctx: Ctx; dest: MockGain; v: CollisionVoice } {
  const ctx = new MockAudioContext();
  const dest = ctx.createGain(); // master
  const noise = makeNoiseBuffer(ctx as unknown as BaseAudioContext);
  const v = new CollisionVoice(
    ctx as unknown as AudioContext,
    dest as unknown as AudioNode,
    noise,
    opts ?? DEFAULT_IMPACT,
  );
  return { ctx, dest, v };
}

describe("impactTier (pure)", () => {
  it("force<=0 yields a silent tier (gain 0)", () => {
    const t = impactTier(0);
    expect(t.gain).toBe(0);
  });

  it("gain and freq are monotonic non-decreasing with force", () => {
    const o = DEFAULT_IMPACT;
    let prevGain = -Infinity;
    let prevFreq = -Infinity;
    for (let f = 0; f <= o.highForce * 1.5; f += o.highForce / 20) {
      const t = impactTier(f);
      expect(t.gain).toBeGreaterThanOrEqual(prevGain - 1e-9);
      expect(t.freq).toBeGreaterThanOrEqual(prevFreq - 1e-9);
      prevGain = t.gain;
      prevFreq = t.freq;
    }
  });

  it("decay is monotonic non-increasing with force (tighter on heavy hits)", () => {
    const o = DEFAULT_IMPACT;
    let prevDecay = Infinity;
    for (let f = 0; f <= o.highForce * 1.5; f += o.highForce / 20) {
      const t = impactTier(f);
      expect(t.decay).toBeLessThanOrEqual(prevDecay + 1e-9);
      prevDecay = t.decay;
    }
  });

  it("low tier at lowForce, high tier at highForce, mid between", () => {
    const o = DEFAULT_IMPACT;
    const lo = impactTier(o.lowForce);
    const mid = impactTier((o.lowForce + o.highForce) / 2);
    const hi = impactTier(o.highForce);
    expect(lo.gain).toBeCloseTo(o.lowGain, 6);
    expect(lo.freq).toBeCloseTo(o.lowFreq, 6);
    expect(hi.gain).toBeCloseTo(o.highGain, 6);
    expect(hi.freq).toBeCloseTo(o.highFreq, 6);
    expect(mid.gain).toBeCloseTo((o.lowGain + o.highGain) / 2, 6);
    expect(lo.gain).toBeLessThan(mid.gain);
    expect(mid.gain).toBeLessThan(hi.gain);
  });

  it("clamps above highForce (no runaway gain)", () => {
    const o = DEFAULT_IMPACT;
    const hi = impactTier(o.highForce);
    const over = impactTier(o.highForce * 50);
    expect(over.gain).toBeCloseTo(hi.gain, 9);
    expect(over.freq).toBeCloseTo(hi.freq, 9);
  });

  it("respects a custom options object", () => {
    const o: ImpactTierOptions = {
      lowForce: 100,
      highForce: 1000,
      lowGain: 0.1,
      highGain: 0.9,
      lowFreq: 100,
      highFreq: 1000,
      decay: 0.2,
      decayHigh: 0.1,
    };
    expect(impactTier(100, o).gain).toBeCloseTo(0.1, 6);
    expect(impactTier(1000, o).gain).toBeCloseTo(0.9, 6);
    expect(impactTier(550, o).freq).toBeCloseTo(550, 6);
  });
});

describe("CollisionVoice — build", () => {
  it("wires noise source -> lowpass -> gain -> destination", () => {
    const { ctx, dest } = makeVoice();
    expect(ctx.bufferSources).toHaveLength(1);
    expect(ctx.biquads).toHaveLength(1);
    expect(ctx.biquads[0]!.type).toBe("lowpass");
    // gains: [0] = caller's dest (master), [1] = the voice env gain.
    expect(ctx.gains).toHaveLength(2);
    const src = ctx.bufferSources[0]!;
    const lp = ctx.biquads[0]!;
    const env = ctx.gains[1]!;
    expect(src.connections).toContain(lp);
    expect(lp.connections).toContain(env);
    expect(env.connections).toContain(dest);
  });

  it("loops the shared noise buffer and starts at gain 0 (silent until hit)", () => {
    const { ctx } = makeVoice();
    const src = ctx.bufferSources[0]!;
    expect(src.loop).toBe(true);
    expect(src.buffer).toBeTruthy();
    expect(src.started).toBe(true);
    expect(ctx.gains[1]!.gain.value).toBe(0);
  });
});

describe("CollisionVoice — trigger (envelope restart)", () => {
  it("sets the lowpass cutoff to params.freq and ramps 0 -> peak -> 0", () => {
    const { ctx, v } = makeVoice();
    v.trigger(ctx as unknown as AudioContext, 1.0, { gain: 0.4, freq: 500, decay: 0.1 });
    const lp = ctx.biquads[0]!;
    const g = ctx.gains[1]!.gain;
    expect(lp.frequency.value).toBe(500);
    // setValueAtTime(0) then ramp to peak then ramp to 0.
    expect(g.value).toBe(0);
    expect(g.ramps.length).toBe(2);
    expect(g.ramps[0]!.value).toBeCloseTo(0.4, 5);
    expect(g.ramps[1]!.value).toBe(0);
  });

  it("retrigger cancels the prior envelope (no gain stacking)", () => {
    const { ctx, v } = makeVoice();
    v.trigger(ctx as unknown as AudioContext, 1.0, { gain: 0.4, freq: 200, decay: 0.2 });
    v.trigger(ctx as unknown as AudioContext, 1.05, { gain: 0.5, freq: 600, decay: 0.1 });
    const g = ctx.gains[1]!.gain;
    // cancelScheduledValues resets the ramp list; final envelope is the 2nd hit.
    expect(g.cancels.length).toBe(2);
    expect(g.value).toBe(0);
    expect(g.ramps.length).toBe(2); // peak + decay
    expect(g.ramps[0]!.value).toBeCloseTo(0.5, 5); // peak (attack)
    expect(g.ramps[1]!.value).toBe(0); // decay tail
  });

  it("decay tail lands at ATTACK+decay after the trigger time", () => {
    const { ctx, v } = makeVoice();
    const now = 2.0;
    v.trigger(ctx as unknown as AudioContext, now, { gain: 0.3, freq: 300, decay: 0.16 });
    const g = ctx.gains[1]!.gain;
    expect(g.ramps[0]!.time).toBeCloseTo(now + 0.004, 5); // ATTACK
    expect(g.ramps[1]!.time).toBeCloseTo(now + 0.004 + 0.16, 5);
  });
});

describe("CollisionVoice — stop + dispose", () => {
  it("stop stops the looping noise source", () => {
    const { ctx, v } = makeVoice();
    v.stop();
    expect(ctx.bufferSources[0]!.stopped).toBe(true);
  });

  it("dispose disconnects the lowpass + gain", () => {
    const { ctx, v } = makeVoice();
    v.stop();
    v.dispose();
    expect(ctx.biquads[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[1]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});
