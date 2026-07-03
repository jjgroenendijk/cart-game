import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { engineCurve } from "./engineCurve";
import { makeMock } from "./mockAudioContext";
import type { ListenerTransform, RivalAudioState } from "./rivalVoices";

const state = (over: Partial<RivalAudioState> = {}): RivalAudioState => ({
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  speed: 0,
  throttle: 0,
  drifting: false,
  ...over,
});

const listener = (over: Partial<ListenerTransform> = {}): ListenerTransform => ({
  pos: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  vel: { x: 0, y: 0, z: 0 },
  ...over,
});

describe("AudioManager — rival positional voices (015)", () => {
  it("updateRivals before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.updateRivals(0.016, [state({ speed: 10 })], listener())).not.toThrow();
  });

  it("setRivalCount(5) before resume builds 5 PannerNodes into sfxBus", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(5);
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.panners).toHaveLength(5);
    const sfxBus = ctx.gains[1]!;
    for (const p of ctx.panners) {
      expect(p.connections).toContain(sfxBus);
    }
    am.dispose();
  });

  it("default rival count 0 builds no panners", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    expect(ref.ctx!.panners).toHaveLength(0);
    am.dispose();
  });

  it("rival engine oscs started + gain 0 at build", () => {
    const base = makeMock();
    const amBase = new AudioManager({ createContext: base.factory, attachVisibility: false });
    amBase.resume();
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(5);
    am.resume();
    const ctx = ref.ctx!;
    // 3 detuned saws + 1 sub sine per rival = 4 oscs; 5 rivals -> +20 vs base.
    const added = ctx.oscillators.length - base.ref.ctx!.oscillators.length;
    expect(added).toBe(5 * 4);
    for (const osc of ctx.oscillators) expect(osc.started).toBe(true);
    // Rival engine gain (the gain wired into a panner) starts silent.
    const rg = ctx.gains.find((g) => g.connections.includes(ctx.panners[0]!));
    expect(rg).toBeDefined();
    expect(rg!.gain.value).toBe(0);
    amBase.dispose();
    am.dispose();
  });

  it("updateRivals writes ctx.listener pos + drives a panner position", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(1);
    am.resume();
    const ctx = ref.ctx!;
    am.updateRivals(
      0.016,
      [state({ pos: { x: 10, y: 0, z: 0 }, speed: 10, throttle: 1 })],
      listener({ pos: { x: 0, y: 0, z: 0 } }),
    );
    expect(ctx.listener.positionX.value).toBe(0);
    expect(ctx.panners[0]!.positionX.value).toBe(10);
    am.dispose();
  });

  it("setEngineActive(false) gates rival gains to 0; (true) restores", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(1);
    am.resume();
    const ctx = ref.ctx!;
    am.updateRivals(
      0.016,
      [state({ speed: 20, throttle: 0.8 })],
      listener({ pos: { x: 0, y: 0, z: 0 } }),
    );
    const rivalGain = ctx.gains.find((g) => g.connections.includes(ctx.panners[0]!))!;
    am.setEngineActive(false);
    expect(rivalGain.gain.targets.at(-1)?.target).toBe(0);
    am.setEngineActive(true);
    const expected = engineCurve({ speed: 20, maxSpeed: 34, throttle: 0.8 }).gain;
    expect(rivalGain.gain.targets.at(-1)?.target).toBeCloseTo(expected, 5);
    am.dispose();
  });

  it("setPositional(false) flattens: update pins panner to listener pos", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(1);
    am.resume();
    const ctx = ref.ctx!;
    am.setPositional(false);
    am.updateRivals(
      0.016,
      [state({ pos: { x: 42, y: 0, z: 0 }, speed: 10, throttle: 1 })],
      listener({ pos: { x: 7, y: 0, z: 0 } }),
    );
    expect(ctx.panners[0]!.positionX.value).toBe(7);
    am.dispose();
  });

  it("setHrtf(true) sets every panner panningModel to HRTF", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(3);
    am.resume();
    const ctx = ref.ctx!;
    am.setHrtf(true);
    expect(ctx.panners.every((p) => p.panningModel === "HRTF")).toBe(true);
    am.setHrtf(false);
    expect(ctx.panners.every((p) => p.panningModel === "equalpower")).toBe(true);
    am.dispose();
  });

  it("no regression: 1P human voices/wind/panners unchanged", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.stereoPanners).toHaveLength(0);
    expect(ctx.bufferSources).toHaveLength(4); // drift + wind + rain + collision
    expect(ctx.panners).toHaveLength(0);
    am.dispose();
  });

  it("dispose disconnects every rival panner", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setRivalCount(5);
    am.resume();
    const ctx = ref.ctx!;
    am.dispose();
    for (const p of ctx.panners) {
      expect(p.disconnects).toBeGreaterThanOrEqual(1);
    }
  });
});
