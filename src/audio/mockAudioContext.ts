/**
 * Shared Web Audio mock for 005 AudioManager tests. jsdom has no AudioContext,
 * so the AudioManager tests inject a hand-rolled mock that records node
 * creation + param ramps. Kept here (not in a .test.ts) so the engine/drift/
 * wind/beeps suites can import a single source of truth.
 *
 * Not part of the runtime bundle: nothing under src/main.ts imports this.
 */

import type { AudioContextFactory } from "./AudioManager";

export class MockParam {
  value = 0;
  targets: { target: number; time: number; tau: number }[] = [];
  ramps: { value: number; time: number }[] = [];
  cancels: { time: number }[] = [];
  setValueAtTime(v: number, _t: number): void {
    this.value = v;
  }
  setTargetAtTime(target: number, time: number, tau: number): void {
    this.targets.push({ target, time, tau });
  }
  linearRampToValueAtTime(v: number, time: number): void {
    this.ramps.push({ value: v, time });
  }
  cancelScheduledValues(time: number): void {
    this.cancels.push({ time });
    this.ramps = [];
    this.targets = [];
  }
}

export class AudioDestinationMock {
  isDestination = true;
}

export class MockNode {
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

export class MockGain extends MockNode {
  readonly gain = new MockParam();
}

export class MockCompressor extends MockNode {
  readonly threshold = new MockParam();
  readonly ratio = new MockParam();
  readonly knee = new MockParam();
}

export class MockOscillator extends MockNode {
  type: OscillatorType = "sine";
  readonly frequency = new MockParam();
  readonly detune = new MockParam();
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class MockBiquad extends MockNode {
  type: BiquadFilterType = "allpass";
  readonly frequency = new MockParam();
  readonly Q = new MockParam();
}

export class MockStereoPanner extends MockNode {
  readonly pan = new MockParam();
}

export class MockBufferSource extends MockNode {
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

export class MockAudioBuffer {
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

export class MockAudioContext {
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
  stereoPanners: MockStereoPanner[] = [];

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
  createStereoPanner(): MockStereoPanner {
    const p = new MockStereoPanner();
    this.stereoPanners.push(p);
    return p;
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
export function makeMock(): {
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
