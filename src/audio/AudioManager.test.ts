import { describe, expect, it } from "vitest";
import { AudioManager, type AudioContextFactory } from "./AudioManager";
import { makeNoiseBuffer } from "./noiseBuffer";

/**
 * Minimal AudioParam mock: records the last setTargetAtTime target and tracks
 * value. Enough for the AudioManager skeleton; extended alongside voices.
 */
class MockParam {
  value = 0;
  targets: { target: number; time: number; tau: number }[] = [];
  ramps: { value: number; time: number }[] = [];
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    void t;
  }
  setTargetAtTime(target: number, time: number, tau: number): void {
    this.targets.push({ target, time, tau });
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.ramps.push({ value: v, time: t });
  }
}

/** Minimal node mock: tracks connect/disconnect and holds AudioParam fields. */
class MockNode {
  static readonly ALL: MockNode[] = [];
  disconnects = 0;
  readonly connections: (MockNode | AudioDestinationMock)[] = [];
  constructor() {
    MockNode.ALL.push(this);
  }
  connect(other: MockNode | AudioDestinationMock): MockNode | AudioDestinationMock {
    this.connections.push(other);
    return other;
  }
  disconnect(): void {
    this.disconnects++;
  }
}

class MockGain extends MockNode {
  readonly gain = new MockParam();
}

class MockCompressor extends MockNode {
  readonly threshold = new MockParam();
  readonly ratio = new MockParam();
  readonly knee = new MockParam();
}

class MockOscillator extends MockNode {
  type: OscillatorType = "sine";
  readonly frequency = new MockParam();
  readonly detune = new MockParam();
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class MockBiquad extends MockNode {
  type: BiquadFilterType = "allpass";
  readonly frequency = new MockParam();
  readonly Q = new MockParam();
}

class MockBufferSource extends MockNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class AudioDestinationMock {
  isDestination = true;
}

/** Minimal AudioBuffer mock backed by a Float64Array. */
class MockAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private readonly channels: Float64Array[];
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = [];
    for (let i = 0; i < numberOfChannels; i++) this.channels.push(new Float64Array(length));
  }
  getChannelData(ch: number): Float64Array {
    return this.channels[ch];
  }
}

/**
 * Minimal AudioContext mock for the skeleton. Voice-node ctors (oscillator,
 * biquad, bufferSource) are added in later-commit tests as needed.
 */
class MockAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  sampleRate = 48000;
  readonly destination = new AudioDestinationMock();
  resumes = 0;
  suspends = 0;
  closed = false;
  gains: MockGain[] = [];
  compressors: MockCompressor[] = [];
  oscillators: MockOscillator[] = [];
  biquads: MockBiquad[] = [];
  bufferSources: MockBufferSource[] = [];

  createGain(): MockGain {
    const g = new MockGain();
    this.gains.push(g);
    return g;
  }
  createDynamicsCompressor(): MockCompressor {
    const c = new MockCompressor();
    this.compressors.push(c);
    return c;
  }
  createOscillator(): MockOscillator {
    const o = new MockOscillator();
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter(): MockBiquad {
    const b = new MockBiquad();
    this.biquads.push(b);
    return b;
  }
  createBufferSource(): MockBufferSource {
    const s = new MockBufferSource();
    this.bufferSources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  resume(): void {
    this.resumes++;
    this.state = "running";
  }
  suspend(): void {
    this.suspends++;
    this.state = "suspended";
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

/**
 * Build a factory that records the MockAudioContext it hands out on a holder.
 * Tests read `ref.ctx` after resume() (the factory only fires then); before
 * resume it stays null so the pre-gesture path is observable.
 */
function makeMock(): {
  factory: AudioContextFactory;
  ref: { ctx: MockAudioContext | null };
} {
  const ref: { ctx: MockAudioContext | null } = { ctx: null };
  const factory: AudioContextFactory = () => {
    ref.ctx = new MockAudioContext();
    return ref.ctx as unknown as AudioContext;
  };
  return { factory, ref };
}

describe("AudioManager — skeleton (pre-gesture + resume + dispose)", () => {
  it("constructs without creating any AudioContext (no autoplay trip)", () => {
    const { factory, ref } = makeMock();
    MockNode.ALL.length = 0;
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    expect(am.isGestured).toBe(false);
    expect(am.isRunning).toBe(false);
    expect(ref.ctx).toBeNull();
    expect(MockNode.ALL.length).toBe(0);
  });

  it("all public methods are no-ops before resume()", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.update(0.016, { speed: 10, throttle: 1, drifting: false })).not.toThrow();
    expect(() => am.uiBeep("click")).not.toThrow();
    expect(() => am.setEngineActive(true)).not.toThrow();
    expect(() => am.suspend()).not.toThrow();
    expect(() => am.setVolume(0.5)).not.toThrow();
    expect(() => am.mute(true)).not.toThrow();
    expect(am.isRunning).toBe(false);
  });

  it("degrades to permanent no-op when AudioContext is unsupported", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    am.resume();
    expect(am.isGestured).toBe(false);
    expect(am.isRunning).toBe(false);
  });

  it("resume() lazily builds ctx + master + compressor and sets gestured", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    expect(am.isGestured).toBe(true);
    expect(am.isRunning).toBe(true);
    expect(ctx.gains.length).toBeGreaterThanOrEqual(1); // master always
    expect(ctx.compressors.length).toBe(1);
  });

  it("master -> compressor -> destination graph is wired", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const master = ctx.gains[0]!;
    const comp = ctx.compressors[0]!;
    expect(master.connections).toContain(comp);
    expect(comp.connections).toContain(ctx.destination);
  });

  it("compressor uses threshold -24, ratio 4, knee 30", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const comp = ref.ctx!.compressors[0]!;
    expect(comp.threshold.value).toBe(-24);
    expect(comp.ratio.value).toBe(4);
    expect(comp.knee.value).toBe(30);
  });

  it("resume() is idempotent: second call does not create a second ctx", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const afterFirst = {
      gains: ref.ctx!.gains.length,
      oscs: ref.ctx!.oscillators.length,
      comps: ref.ctx!.compressors.length,
    };
    am.resume();
    am.resume();
    expect(ref.ctx!.gains.length).toBe(afterFirst.gains);
    expect(ref.ctx!.oscillators.length).toBe(afterFirst.oscs);
    expect(ref.ctx!.compressors.length).toBe(afterFirst.comps);
    expect(am.isGestured).toBe(true);
  });

  it("resume() on a suspended ctx calls ctx.resume()", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    ctx.state = "suspended";
    am.resume();
    expect(ctx.resumes).toBe(1);
  });

  it("setVolume/mute ramp master gain via setTargetAtTime", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const master = ref.ctx!.gains[0]!;
    am.setVolume(0.25);
    expect(master.gain.targets.at(-1)?.target).toBeCloseTo(0.25, 5);
    am.mute(true);
    expect(master.gain.targets.at(-1)?.target).toBe(0);
    am.mute(false);
    expect(master.gain.targets.at(-1)?.target).toBeCloseTo(0.25, 5);
  });

  it("suspend() calls ctx.suspend() when running", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.suspend();
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe("suspended");
  });

  it("dispose() closes ctx, disconnects master + compressor, clears gestured", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const master = ctx.gains[0]!;
    const comp = ctx.compressors[0]!;
    am.dispose();
    expect(ctx.closed).toBe(true);
    expect(master.disconnects).toBeGreaterThanOrEqual(1);
    expect(comp.disconnects).toBeGreaterThanOrEqual(1);
    expect(am.isGestured).toBe(false);
    expect(am.isRunning).toBe(false);
  });

  it("dispose() is idempotent", () => {
    const { factory } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    expect(() => am.dispose()).not.toThrow();
    expect(() => am.dispose()).not.toThrow();
  });
});

describe("AudioManager — engine voice", () => {
  it("update() before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.update(0.016, { speed: 20, throttle: 1, drifting: false })).not.toThrow();
  });

  it("resume() builds 3 detuned saw osc + 1 sub sine + lowpass + gain", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.oscillators.length).toBe(4);
    // exactly one engine lowpass (drift/wind add their own filters later)
    expect(ctx.biquads.filter((b) => b.type === "lowpass").length).toBeGreaterThanOrEqual(1);
    // engineGain present (master + engine + drift + wind)
    expect(ctx.gains.length).toBeGreaterThanOrEqual(2);
    const saws = ctx.oscillators.slice(0, 3);
    expect(saws.every((o) => o.type === "sawtooth")).toBe(true);
    expect(saws.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-12, 0, 12]);
    const sub = ctx.oscillators[3]!;
    expect(sub.type).toBe("sine");
  });

  it("engine oscs -> lowpass -> engineGain -> master graph is wired", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const lowpass = ctx.biquads[0]!;
    const engineGain = ctx.gains[1]!;
    const master = ctx.gains[0]!;
    for (const osc of ctx.oscillators) {
      expect(osc.connections).toContain(lowpass);
    }
    expect(lowpass.connections).toContain(engineGain);
    expect(engineGain.connections).toContain(master);
  });

  it("all engine oscs are started once", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    for (const osc of ref.ctx!.oscillators) {
      expect(osc.started).toBe(true);
    }
  });

  it("engineGain starts silent (0) so resume does not pop", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const engineGain = ref.ctx!.gains[1]!;
    expect(engineGain.gain.value).toBe(0);
  });

  it("update sets osc frequency via setTargetAtTime following engineCurve", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.update(0.016, { speed: 17, throttle: 1, drifting: false });
    // speed 17/34 = 0.5 -> gear 3, local 0 -> tierPeak * lowRatio.
    const expected = 55 * Math.pow(320 / 55, 3 / 5) * 0.55;
    for (const osc of ctx.oscillators.slice(0, 3)) {
      expect(osc.frequency.targets.at(-1)?.target).toBeCloseTo(expected, 1);
    }
    // Sub sine is one octave below.
    expect(ctx.oscillators[3]!.frequency.targets.at(-1)?.target).toBeCloseTo(expected / 2, 1);
  });

  it("update ramps lowpass cutoff from idle->top across speed 0->maxSpeed", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.update(0.016, { speed: 0, throttle: 0, drifting: false });
    const idleCut = ctx.biquads[0]!.frequency.targets.at(-1)?.target;
    expect(idleCut).toBeCloseTo(700, 1);
    am.update(0.016, { speed: 34, throttle: 1, drifting: false });
    const topCut = ctx.biquads[0]!.frequency.targets.at(-1)?.target;
    expect(topCut).toBeCloseTo(3800, 1);
  });

  it("setEngineActive(false) ramps engineGain target to 0", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 10, throttle: 1, drifting: false }); // prime lastGain
    const engineGain = ref.ctx!.gains[1]!;
    am.setEngineActive(false);
    expect(engineGain.gain.targets.at(-1)?.target).toBe(0);
  });

  it("setEngineActive(true) ramps engineGain target to engineCurve gain", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 10, throttle: 0.5, drifting: false });
    const engineGain = ref.ctx!.gains[1]!;
    am.setEngineActive(false);
    am.setEngineActive(true);
    // target restored to last computed gain (throttle 0.5 -> lerp idle,full)
    const expected = 0.05 + (0.2 - 0.05) * 0.5;
    expect(engineGain.gain.targets.at(-1)?.target).toBeCloseTo(expected, 4);
  });

  it("dispose stops + disconnects every engine node", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const oscs = ctx.oscillators.slice();
    am.dispose();
    for (const osc of oscs) {
      expect(osc.stopped).toBe(true);
      expect(osc.disconnects).toBeGreaterThanOrEqual(1);
    }
    expect(ctx.biquads[0]!.disconnects).toBeGreaterThanOrEqual(1);
    expect(ctx.gains[1]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});

describe("AudioManager — drift + wind voices", () => {
  it("resume() builds a shared noise buffer + 2 looping sources", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.bufferSources.length).toBe(2);
    const noise = ctx.bufferSources[0]!.buffer as { length: number };
    expect(noise.length).toBeGreaterThan(0);
    expect(ctx.bufferSources[0]!.loop).toBe(true);
    expect(ctx.bufferSources[1]!.loop).toBe(true);
    expect(ctx.bufferSources[0]!.buffer).toBe(ctx.bufferSources[1]!.buffer);
    for (const s of ctx.bufferSources) expect(s.started).toBe(true);
  });

  it("drift source -> bandpass -> gain -> master; wind source -> lowpass -> gain -> master", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const master = ctx.gains[0]!;
    // 2 biquads now: engine lowpass (idx 0), drift bandpass (idx 1), wind lowpass (idx 2)
    const driftBand = ctx.biquads.find((b) => b.type === "bandpass")!;
    const windLow = ctx.biquads.find((b) => b.type === "lowpass" && b !== ctx.biquads[0])!;
    const driftGain = ctx.gains[2]!;
    const windGain = ctx.gains[3]!;
    expect(ctx.bufferSources[0]!.connections).toContain(driftBand);
    expect(driftBand.connections).toContain(driftGain);
    expect(driftGain.connections).toContain(master);
    expect(ctx.bufferSources[1]!.connections).toContain(windLow);
    expect(windLow.connections).toContain(windGain);
    expect(windGain.connections).toContain(master);
  });

  it("drift bandpass = bandpass 1500Hz Q 0.8; wind lowpass = 500Hz", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const driftBand = ctx.biquads.find((b) => b.type === "bandpass")!;
    expect(driftBand.frequency.value).toBe(1500);
    expect(driftBand.Q.value).toBeCloseTo(0.8, 5);
    const windLow = ctx.biquads.find((b) => b.type === "lowpass" && b !== ctx.biquads[0])!;
    expect(windLow.frequency.value).toBe(500);
  });

  it("drift + wind gains start at 0 (silent at rest)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    expect(ref.ctx!.gains[2]!.gain.value).toBe(0);
    expect(ref.ctx!.gains[3]!.gain.value).toBe(0);
  });

  it("driftGain target stays 0 when not drifting", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 30, throttle: 1, drifting: false });
    expect(ref.ctx!.gains[2]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("driftGain target stays 0 when drifting but speed<=7", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 5, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[2]!.gain.targets.at(-1)?.target).toBe(0);
    am.update(0.016, { speed: 7, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[2]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("driftGain target = driftGain when drifting && speed>7", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 20, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[2]!.gain.targets.at(-1)?.target).toBeCloseTo(0.16, 5);
  });

  it("windGain target = 0 at speed 0", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 0, throttle: 0, drifting: false });
    expect(ref.ctx!.gains[3]!.gain.targets.at(-1)?.target).toBeCloseTo(0, 5);
  });

  it("windGain target rises to windGain (0.09) at maxSpeed", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 34, throttle: 1, drifting: false });
    expect(ref.ctx!.gains[3]!.gain.targets.at(-1)?.target).toBeCloseTo(0.09, 5);
  });

  it("update() before resume() is a no-op for drift/wind", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.update(0.016, { speed: 20, throttle: 1, drifting: true })).not.toThrow();
  });

  it("dispose stops + disconnects every drift/wind node", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sources = ctx.bufferSources.slice();
    const driftBand = ctx.biquads.find((b) => b.type === "bandpass")!;
    const windLow = ctx.biquads.find((b) => b.type === "lowpass" && b !== ctx.biquads[0])!;
    const driftGain = ctx.gains[2]!;
    const windGain = ctx.gains[3]!;
    am.dispose();
    for (const s of sources) {
      expect(s.stopped).toBe(true);
      expect(s.disconnects).toBeGreaterThanOrEqual(1);
    }
    expect(driftBand.disconnects).toBeGreaterThanOrEqual(1);
    expect(windLow.disconnects).toBeGreaterThanOrEqual(1);
    expect(driftGain.disconnects).toBeGreaterThanOrEqual(1);
    expect(windGain.disconnects).toBeGreaterThanOrEqual(1);
  });
});

describe("makeNoiseBuffer", () => {
  it("fills a mono buffer with length ~= seconds * sampleRate", () => {
    const ctx = new MockAudioContext();
    const buf = makeNoiseBuffer(ctx as unknown as BaseAudioContext, 2);
    expect(buf.length).toBe(2 * 48000);
    expect(buf.sampleRate).toBe(48000);
    expect(buf.numberOfChannels).toBe(1);
  });

  it("samples are in [-1, 1) (white noise, not zeros)", () => {
    const ctx = new MockAudioContext();
    const buf = makeNoiseBuffer(ctx as unknown as BaseAudioContext, 0.01);
    const data = buf.getChannelData(0);
    let nonZero = 0;
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(-1);
      expect(data[i]).toBeLessThan(1);
      if (data[i] !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });
});
