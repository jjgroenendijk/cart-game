import { describe, expect, it } from "vitest";
import {
  dopplerShift,
  pannerDefaults,
  PositionalVoice,
  RivalVoiceBank,
  type DopplerOptions,
  type ListenerTransform,
  type RivalAudioState,
} from "./rivalVoices";
import type { EngineVoiceConfig } from "./voiceSet";
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

type Ctx = MockAudioContext;

const ORIGIN = { x: 0, y: 0, z: 0 };
const FORWARD_NEG_Z = { x: 0, y: 0, z: -1 };

// speed 17/34 -> gear 3, local 0 -> tierPeak * lowRatio (parity w/ voiceSet)
const CURVE_FREQ_17 = 55 * Math.pow(320 / 55, 3 / 5) * 0.55;

function makeVoice(): { ctx: Ctx; dest: ReturnType<Ctx["createGain"]>; v: PositionalVoice } {
  const ctx = new MockAudioContext();
  const dest = ctx.createGain(); // gains[0]
  const noise = makeNoiseBuffer(ctx as unknown as BaseAudioContext);
  const v = new PositionalVoice(
    ctx as unknown as AudioContext,
    dest as unknown as AudioNode,
    noise,
    engine,
  );
  return { ctx, dest, v };
}

function makeBank(count: number): {
  ctx: Ctx;
  dest: ReturnType<Ctx["createGain"]>;
  bank: RivalVoiceBank;
} {
  const ctx = new MockAudioContext();
  const dest = ctx.createGain();
  const noise = makeNoiseBuffer(ctx as unknown as BaseAudioContext);
  const bank = new RivalVoiceBank(
    ctx as unknown as AudioContext,
    dest as unknown as AudioNode,
    noise,
    engine,
    count,
  );
  return { ctx, dest, bank };
}

describe("dopplerShift", () => {
  const lisPos = ORIGIN;
  const lisVel = ORIGIN;

  it("source approaching head-on -> mult > 1", () => {
    // src at z=10 moving toward listener at origin (vel -z).
    const m = dopplerShift({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -5 }, lisPos, lisVel);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeCloseTo(343 / 338, 6);
  });

  it("source receding -> mult < 1", () => {
    const m = dopplerShift({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 5 }, lisPos, lisVel);
    expect(m).toBeLessThan(1);
    expect(m).toBeCloseTo(343 / 348, 6);
  });

  it("stationary source + listener -> 1", () => {
    expect(dopplerShift({ x: 0, y: 0, z: 10 }, ORIGIN, lisPos, lisVel)).toBe(1);
  });

  it("clamps to max 2.0 at high approach velocity", () => {
    const m = dopplerShift({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -200 }, lisPos, lisVel);
    expect(m).toBe(2);
  });

  it("clamps to min 0.5 at high recede velocity", () => {
    const m = dopplerShift({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 400 }, lisPos, lisVel);
    expect(m).toBe(0.5);
  });

  it("dist ~ 0 -> 1 (coincident, dir undefined)", () => {
    expect(dopplerShift(ORIGIN, { x: 0, y: 0, z: -50 }, lisPos, lisVel)).toBe(1);
  });

  it("honors opts (factor 0 disables doppler -> 1)", () => {
    const opts: DopplerOptions = { factor: 0 };
    expect(dopplerShift({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -50 }, lisPos, lisVel, opts)).toBe(
      1,
    );
  });

  it("is pure (same args -> same result)", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: -4, y: 0, z: 5 };
    expect(dopplerShift(a, b, lisPos, lisVel)).toBe(dopplerShift(a, b, lisPos, lisVel));
  });
});

describe("pannerDefaults", () => {
  it("returns equalpower / inverse / 5 / 120 / 1", () => {
    const d = pannerDefaults();
    expect(d.panningModel).toBe("equalpower");
    expect(d.distanceModel).toBe("inverse");
    expect(d.refDistance).toBe(5);
    expect(d.maxDistance).toBe(120);
    expect(d.rolloffFactor).toBe(1);
  });
});

describe("PositionalVoice - build", () => {
  it("creates one panner connected to dest; lowpass -> engineGain -> panner", () => {
    const { ctx, dest } = makeVoice();
    expect(ctx.panners).toHaveLength(1);
    const panner = ctx.panners[0]!;
    expect(panner.connections).toContain(dest);
    const lowpass = ctx.biquads[0]!;
    const engineGain = ctx.gains[1]!; // gains: [dest, engineGain]
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.connections).toContain(engineGain);
    expect(engineGain.connections).toContain(panner);
  });

  it("builds 3 detuned saw oscs + 1 sub sine, all started", () => {
    const { ctx } = makeVoice();
    expect(ctx.oscillators).toHaveLength(4);
    const saws = ctx.oscillators.slice(0, 3);
    expect(saws.every((o) => o.type === "sawtooth")).toBe(true);
    expect(saws.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-12, 0, 12]);
    expect(ctx.oscillators[3]!.type).toBe("sine");
    for (const o of ctx.oscillators) expect(o.started).toBe(true);
  });

  it("engine oscs (saws + sub) -> lowpass", () => {
    const { ctx } = makeVoice();
    const lowpass = ctx.biquads[0]!;
    for (const osc of ctx.oscillators) {
      expect(osc.connections).toContain(lowpass);
    }
  });

  it("panner panningModel defaults to equalpower", () => {
    const { ctx } = makeVoice();
    expect(ctx.panners[0]!.panningModel).toBe("equalpower");
  });

  it("engineGain starts silent (0)", () => {
    const { ctx } = makeVoice();
    expect(ctx.gains[1]!.gain.value).toBe(0);
  });
});

describe("PositionalVoice - update", () => {
  const approachingState: RivalAudioState = {
    pos: { x: 0, y: 0, z: 10 },
    vel: { x: 0, y: 0, z: -5 },
    speed: 17,
    throttle: 1,
    drifting: false,
  };
  const listener: ListenerTransform = {
    pos: { x: 0, y: 0, z: 0 },
    forward: FORWARD_NEG_Z,
    vel: ORIGIN,
  };

  it("spatial on: panner.positionZ set to state.pos.z; osc freq = curveFreq * dopplerMult", () => {
    const { ctx, v } = makeVoice();
    v.update(ctx as unknown as AudioContext, 0, approachingState, listener);
    expect(ctx.panners[0]!.positionZ.value).toBeCloseTo(10, 6);
    const mult = 343 / 338;
    const expected = CURVE_FREQ_17 * mult;
    for (const o of ctx.oscillators.slice(0, 3)) {
      expect(o.frequency.targets.at(-1)?.target).toBeCloseTo(expected, 4);
    }
    expect(ctx.oscillators[3]!.frequency.targets.at(-1)?.target).toBeCloseTo(expected / 2, 4);
  });

  it("spatial off: panner pinned to listener.pos; osc freq = plain curveFreq (mult 1)", () => {
    const { ctx, v } = makeVoice();
    const lis: ListenerTransform = { ...listener, pos: { x: 7, y: 0, z: 0 } };
    v.setSpatial(ctx as unknown as AudioContext, false, lis);
    v.update(ctx as unknown as AudioContext, 0, approachingState, lis);
    expect(ctx.panners[0]!.positionX.value).toBeCloseTo(7, 6);
    for (const o of ctx.oscillators.slice(0, 3)) {
      expect(o.frequency.targets.at(-1)?.target).toBeCloseTo(CURVE_FREQ_17, 4);
    }
  });

  it("update ramps lowpass cutoff from idle->top across speed 0->maxSpeed", () => {
    const { ctx, v } = makeVoice();
    v.update(ctx as unknown as AudioContext, 0, { ...approachingState, speed: 0 }, listener);
    expect(ctx.biquads[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(700, 1);
    v.update(ctx as unknown as AudioContext, 0, { ...approachingState, speed: 34 }, listener);
    expect(ctx.biquads[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(3800, 1);
  });
});

describe("PositionalVoice - distance skip (022)", () => {
  const listener: ListenerTransform = {
    pos: ORIGIN,
    forward: FORWARD_NEG_Z,
    vel: ORIGIN,
  };
  const farState: RivalAudioState = {
    pos: { x: 0, y: 0, z: 200 },
    vel: { x: 0, y: 0, z: -5 },
    speed: 17,
    throttle: 1,
    drifting: false,
  };
  const nearState: RivalAudioState = {
    pos: { x: 0, y: 0, z: 10 },
    vel: { x: 0, y: 0, z: -5 },
    speed: 17,
    throttle: 1,
    drifting: false,
  };

  it("out-transition ramps engineGain to 0 once, then skips writes", () => {
    const { ctx, v } = makeVoice();
    v.update(ctx as unknown as AudioContext, 0, farState, listener);
    expect(ctx.gains[1]!.gain.targets.at(-1)?.target).toBe(0);
    const oscN = ctx.oscillators[0]!.frequency.targets.length;
    const gainN = ctx.gains[1]!.gain.targets.length;
    const panN = ctx.panners[0]!.positionZ.targets.length;
    // still far -> fully skipped (no new ramps)
    v.update(ctx as unknown as AudioContext, 0, farState, listener);
    expect(ctx.oscillators[0]!.frequency.targets.length).toBe(oscN);
    expect(ctx.gains[1]!.gain.targets.length).toBe(gainN);
    expect(ctx.panners[0]!.positionZ.targets.length).toBe(panN);
  });

  it("re-entering range resumes engine freq + gain writes", () => {
    const { ctx, v } = makeVoice();
    v.update(ctx as unknown as AudioContext, 0, farState, listener); // skip
    expect(ctx.gains[1]!.gain.targets.at(-1)?.target).toBe(0);
    v.update(ctx as unknown as AudioContext, 0, nearState, listener); // resume
    const expected = CURVE_FREQ_17 * (343 / 338);
    expect(ctx.oscillators[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(expected, 4);
    // gain ramped back toward the curve gain (not 0)
    expect(ctx.gains[1]!.gain.targets.at(-1)?.target).toBeGreaterThan(0);
  });

  it("spatial off -> never skips even when far", () => {
    const { ctx, v } = makeVoice();
    v.setSpatial(ctx as unknown as AudioContext, false, listener);
    v.update(ctx as unknown as AudioContext, 0, farState, listener);
    // panner pinned to listener, doppler mult 1 -> plain curve freq written
    expect(ctx.oscillators[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(CURVE_FREQ_17, 4);
    expect(ctx.panners[0]!.positionX.value).toBeCloseTo(0, 6);
  });

  it("setActive(false) gates: update skips writes while inactive", () => {
    const { ctx, v } = makeVoice();
    v.update(ctx as unknown as AudioContext, 0, nearState, listener); // active prime
    v.setActive(ctx as unknown as AudioContext, false);
    const oscN = ctx.oscillators[0]!.frequency.targets.length;
    v.update(ctx as unknown as AudioContext, 0, nearState, listener);
    expect(ctx.oscillators[0]!.frequency.targets.length).toBe(oscN);
  });
});

describe("PositionalVoice - active + hrtf", () => {
  it("setActive(false) gates engineGain to 0; setActive(true) restores curve gain", () => {
    const { ctx, v } = makeVoice();
    const listener: ListenerTransform = {
      pos: ORIGIN,
      forward: FORWARD_NEG_Z,
      vel: ORIGIN,
    };
    v.update(
      ctx as unknown as AudioContext,
      0,
      {
        pos: ORIGIN,
        vel: ORIGIN,
        speed: 10,
        throttle: 0.5,
        drifting: false,
      },
      listener,
    );
    const engineGain = ctx.gains[1]!;
    v.setActive(ctx as unknown as AudioContext, false);
    expect(engineGain.gain.targets.at(-1)?.target).toBe(0);
    v.setActive(ctx as unknown as AudioContext, true);
    const expected = 0.05 + (0.2 - 0.05) * 0.5;
    expect(engineGain.gain.targets.at(-1)?.target).toBeCloseTo(expected, 4);
  });

  it("setHrtf(true) flips panner.panningModel to HRTF; false -> equalpower", () => {
    const { ctx, v } = makeVoice();
    v.setHrtf(ctx as unknown as AudioContext, true);
    expect(ctx.panners[0]!.panningModel).toBe("HRTF");
    v.setHrtf(ctx as unknown as AudioContext, false);
    expect(ctx.panners[0]!.panningModel).toBe("equalpower");
  });
});

describe("PositionalVoice - dispose", () => {
  it("disconnects panner + engine nodes", () => {
    const { ctx, v } = makeVoice();
    v.stop();
    v.dispose();
    expect(ctx.panners[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.biquads[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[1]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});

describe("RivalVoiceBank", () => {
  it("builds N panners", () => {
    const { ctx } = makeBank(3);
    expect(ctx.panners).toHaveLength(3);
  });

  it("update writes ctx.listener position/forward/up", () => {
    const { ctx, bank } = makeBank(3);
    const listener: ListenerTransform = {
      pos: { x: 3, y: 0, z: 0 },
      forward: FORWARD_NEG_Z,
      vel: ORIGIN,
    };
    const state: RivalAudioState = {
      pos: { x: 0, y: 0, z: 10 },
      vel: ORIGIN,
      speed: 17,
      throttle: 1,
      drifting: false,
    };
    bank.update(ctx as unknown as AudioContext, 0, [state], listener);
    expect(ctx.listener.positionX.value).toBeCloseTo(3, 6);
    expect(ctx.listener.forwardZ.value).toBeCloseTo(-1, 6);
    expect(ctx.listener.upY.value).toBeCloseTo(1, 6);
  });

  it("update drives voice[0] with doppler-shifted freq", () => {
    const { ctx, bank } = makeBank(3);
    const listener: ListenerTransform = {
      pos: ORIGIN,
      forward: FORWARD_NEG_Z,
      vel: ORIGIN,
    };
    const state: RivalAudioState = {
      pos: { x: 0, y: 0, z: 10 },
      vel: { x: 0, y: 0, z: -5 },
      speed: 17,
      throttle: 1,
      drifting: false,
    };
    bank.update(ctx as unknown as AudioContext, 0, [state], listener);
    // voice[0] osc freq = curveFreq * dopplerMult (343/338).
    const expected = CURVE_FREQ_17 * (343 / 338);
    expect(ctx.oscillators[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(expected, 4);
  });

  it("setHrtf flips panningModel on all voices", () => {
    const { ctx, bank } = makeBank(2);
    bank.setHrtf(true);
    for (const p of ctx.panners) expect(p.panningModel).toBe("HRTF");
    bank.setHrtf(false);
    for (const p of ctx.panners) expect(p.panningModel).toBe("equalpower");
  });

  it("dispose disconnects all panners + engine gains", () => {
    const { ctx, bank } = makeBank(2);
    bank.dispose();
    for (const p of ctx.panners) expect(p.disconnects).toBeGreaterThanOrEqual(1);
    // gains: [dest, engineGain0, engineGain1]; dest is caller-owned.
    expect(ctx.gains[1]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[2]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});
