// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { makeNoiseBuffer } from "./noiseBuffer";
import { makeMock, MockAudioContext, MockNode } from "./mockAudioContext";

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

describe("AudioManager — visibility-resume respects pause (077 G)", () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  }

  it("does NOT auto-resume on tab return while pause-suspended", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: true });
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.resumes).toBe(0);
    am.setPaused(true);
    expect(ctx.state).toBe("suspended");
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resumes).toBe(0);
    am.setPaused(false);
    expect(ctx.resumes).toBe(1);
    am.dispose();
  });

  it("auto-resumes on tab return when not paused", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: true });
    am.resume();
    const ctx = ref.ctx!;
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.state).toBe("suspended");
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resumes).toBe(1);
    am.dispose();
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
