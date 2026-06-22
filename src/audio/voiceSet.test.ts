import { describe, expect, it } from "vitest";
import { VoiceSet, panForIndex, type DriftVoiceConfig, type EngineVoiceConfig } from "./voiceSet";
import { MockAudioContext } from "./mockAudioContext";
import { makeNoiseBuffer } from "./noiseBuffer";

const engine: EngineVoiceConfig = {
  maxSpeed: 34,
  idleHz: 55,
  topHz: 320,
  lowRatio: 0.55,
  highRatio: 1.0,
  idleGain: 0.05,
  fullGain: 0.2,
  gears: 6,
  lowpassIdle: 700,
  lowpassTop: 3800,
  tau: 0.08,
};

const drift: DriftVoiceConfig = {
  driftGain: 0.16,
  driftBandHz: 1500,
  driftQ: 0.8,
  driftTau: 0.05,
  driftThreshold: 7,
};

type Ctx = MockAudioContext;

function makeVoiceSet(): { ctx: Ctx; dest: ReturnType<Ctx["createGain"]>; vs: VoiceSet } {
  const ctx = new MockAudioContext();
  const dest = ctx.createGain(); // master (gains[0])
  const noise = makeNoiseBuffer(ctx as unknown as BaseAudioContext);
  const vs = new VoiceSet(ctx as unknown as AudioContext, dest as unknown as AudioNode, noise, {
    engine,
    drift,
  });
  return { ctx, dest, vs };
}

describe("panForIndex", () => {
  it("1 voice -> 0 (center)", () => {
    expect(panForIndex(0, 1)).toBe(0);
  });

  it("2 voices -> P1 -1 (left), P2 +1 (right)", () => {
    expect(panForIndex(0, 2)).toBe(-1);
    expect(panForIndex(1, 2)).toBe(+1);
  });

  it("is pure (same args -> same value)", () => {
    expect(panForIndex(0, 2)).toBe(panForIndex(0, 2));
    expect(panForIndex(0, 1)).toBe(panForIndex(99, 1));
  });
});

describe("VoiceSet — build", () => {
  it("builds engine lowpass + drift bandpass, engine gain + drift gain", () => {
    const { ctx } = makeVoiceSet();
    expect(ctx.biquads).toHaveLength(2);
    expect(ctx.biquads[0]!.type).toBe("lowpass");
    expect(ctx.biquads[1]!.type).toBe("bandpass");
    // gains: [master, engineGain, driftGain]
    expect(ctx.gains).toHaveLength(3);
    expect(ctx.gains[1]!.gain.value).toBe(0); // engine starts silent
    expect(ctx.gains[2]!.gain.value).toBe(0); // drift starts silent
  });

  it("builds 3 detuned saw engine oscs + 1 sub sine", () => {
    const { ctx } = makeVoiceSet();
    expect(ctx.oscillators).toHaveLength(4);
    const saws = ctx.oscillators.slice(0, 3);
    expect(saws.every((o) => o.type === "sawtooth")).toBe(true);
    expect(saws.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-12, 0, 12]);
    expect(ctx.oscillators[3]!.type).toBe("sine");
  });

  it("builds one drift source looping the shared noise buffer", () => {
    const { ctx } = makeVoiceSet();
    expect(ctx.bufferSources).toHaveLength(1);
    const src = ctx.bufferSources[0]!;
    expect(src.loop).toBe(true);
    expect(src.buffer).toBeTruthy();
  });

  it("engine oscs -> lowpass -> engineGain -> destination", () => {
    const { ctx, dest } = makeVoiceSet();
    const lowpass = ctx.biquads[0]!;
    const engineGain = ctx.gains[1]!;
    for (const osc of ctx.oscillators) {
      expect(osc.connections).toContain(lowpass);
    }
    expect(lowpass.connections).toContain(engineGain);
    expect(engineGain.connections).toContain(dest);
  });

  it("drift source -> bandpass -> driftGain -> destination", () => {
    const { ctx, dest } = makeVoiceSet();
    const src = ctx.bufferSources[0]!;
    const band = ctx.biquads[1]!;
    const driftGain = ctx.gains[2]!;
    expect(src.connections).toContain(band);
    expect(band.connections).toContain(driftGain);
    expect(driftGain.connections).toContain(dest);
  });

  it("starts every oscillator + the drift source", () => {
    const { ctx } = makeVoiceSet();
    for (const o of ctx.oscillators) expect(o.started).toBe(true);
    expect(ctx.bufferSources[0]!.started).toBe(true);
  });
});

describe("VoiceSet — update + active", () => {
  it("update ramps engine freq via engineCurve (speed 17/34 -> gear 3 local 0)", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 17, 1, false);
    const expected = 55 * Math.pow(320 / 55, 3 / 5) * 0.55;
    for (const o of ctx.oscillators.slice(0, 3)) {
      expect(o.frequency.targets.at(-1)?.target).toBeCloseTo(expected, 1);
    }
    // sub sine one octave below
    expect(ctx.oscillators[3]!.frequency.targets.at(-1)?.target).toBeCloseTo(expected / 2, 1);
  });

  it("update ramps lowpass cutoff from idle->top across speed 0->maxSpeed", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 0, 0, false);
    expect(ctx.biquads[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(700, 1);
    vs.update(ctx as unknown as AudioContext, 0, 34, 1, false);
    expect(ctx.biquads[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(3800, 1);
  });

  it("update keeps drift gain 0 when not drifting", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 30, 1, false);
    expect(ctx.gains[2]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("update keeps drift gain 0 when drifting but speed<=threshold", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 5, 1, true);
    expect(ctx.gains[2]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("update opens drift gain when drifting && speed>threshold", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 20, 1, true);
    expect(ctx.gains[2]!.gain.targets.at(-1)?.target).toBeCloseTo(0.16, 5);
  });

  it("setActive(false) ramps engineGain target to 0", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 10, 1, false); // prime lastGain
    vs.setActive(ctx as unknown as AudioContext, false);
    expect(ctx.gains[1]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("setActive(true) restores engineGain target to the curve gain", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.update(ctx as unknown as AudioContext, 0, 10, 0.5, false);
    vs.setActive(ctx as unknown as AudioContext, false);
    vs.setActive(ctx as unknown as AudioContext, true);
    const expected = 0.05 + (0.2 - 0.05) * 0.5;
    expect(ctx.gains[1]!.gain.targets.at(-1)?.target).toBeCloseTo(expected, 4);
  });
});

describe("VoiceSet — stop + dispose", () => {
  it("stop stops every oscillator + the drift source", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.stop();
    for (const o of ctx.oscillators) expect(o.stopped).toBe(true);
    expect(ctx.bufferSources[0]!.stopped).toBe(true);
  });

  it("dispose disconnects the engine + drift nodes", () => {
    const { ctx, vs } = makeVoiceSet();
    vs.stop();
    vs.dispose();
    expect(ctx.biquads[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[1]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.biquads[1]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[2]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});
