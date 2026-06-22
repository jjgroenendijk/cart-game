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
    expect(ctx.gains.length).toBe(1);
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
    am.resume();
    am.resume();
    expect(ref.ctx!.gains.length).toBe(1);
    expect(ref.ctx!.compressors.length).toBe(1);
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
