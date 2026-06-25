import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { engineCurve } from "./engineCurve";
import { makeMock } from "./mockAudioContext";

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
    // engine voice = first 4 oscs (3 saws + 1 sub sine); the music bed adds
    // its own pad saws after (009), so scope to the engine subset.
    const engine = ctx.oscillators.slice(0, 4);
    expect(engine.length).toBe(4);
    // exactly one engine lowpass (drift/wind/music add their own later)
    expect(ctx.biquads.filter((b) => b.type === "lowpass").length).toBeGreaterThanOrEqual(1);
    // engineGain present (master + engine + drift + wind)
    expect(ctx.gains.length).toBeGreaterThanOrEqual(2);
    const saws = engine.slice(0, 3);
    expect(saws.every((o) => o.type === "sawtooth")).toBe(true);
    expect(saws.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-12, 0, 12]);
    const sub = engine[3]!;
    expect(sub.type).toBe("sine");
  });

  it("engine oscs -> lowpass -> engineGain -> sfxBus graph is wired", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const lowpass = ctx.biquads[0]!;
    // gains: [master, sfxBus, musicBus, engine, drift, wind, ...]
    const sfxBus = ctx.gains[1]!;
    const engineGain = ctx.gains[3]!;
    // only the engine oscs route through the engine lowpass (music pads have
    // their own lowpass; 009).
    const engineOscs = ctx.oscillators.slice(0, 4);
    for (const osc of engineOscs) {
      expect(osc.connections).toContain(lowpass);
    }
    expect(lowpass.connections).toContain(engineGain);
    expect(engineGain.connections).toContain(sfxBus);
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
    const engineGain = ref.ctx!.gains[3]!;
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
    const engineGain = ref.ctx!.gains[3]!;
    am.setEngineActive(false);
    expect(engineGain.gain.targets.at(-1)?.target).toBe(0);
  });

  it("setEngineActive(true) ramps engineGain target to engineCurve gain", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 10, throttle: 0.5, drifting: false });
    const engineGain = ref.ctx!.gains[3]!;
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
    expect(ctx.gains[3]!.disconnects).toBeGreaterThanOrEqual(1);
  });
});

describe("AudioManager — drift + wind voices", () => {
  it("resume() builds a shared noise buffer + the looping sources", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    // drift + wind + collision (009) all loop the shared noise buffer.
    expect(ctx.bufferSources.length).toBe(3);
    const noise = ctx.bufferSources[0]!.buffer as { length: number };
    expect(noise.length).toBeGreaterThan(0);
    for (const s of ctx.bufferSources) {
      expect(s.loop).toBe(true);
      expect(s.buffer).toBe(ctx.bufferSources[0]!.buffer);
      expect(s.started).toBe(true);
    }
  });

  it("drift source -> bandpass -> gain -> sfxBus; wind source -> lowpass -> gain -> sfxBus", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    // biquads: engine lowpass (idx 0), drift bandpass, wind lowpass
    const driftBand = ctx.biquads.find((b) => b.type === "bandpass")!;
    const windLow = ctx.biquads.find((b) => b.type === "lowpass" && b !== ctx.biquads[0])!;
    const driftGain = ctx.gains[4]!;
    const windGain = ctx.gains[5]!;
    expect(ctx.bufferSources[0]!.connections).toContain(driftBand);
    expect(driftBand.connections).toContain(driftGain);
    expect(driftGain.connections).toContain(sfxBus);
    expect(ctx.bufferSources[1]!.connections).toContain(windLow);
    expect(windLow.connections).toContain(windGain);
    expect(windGain.connections).toContain(sfxBus);
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
    expect(ref.ctx!.gains[4]!.gain.value).toBe(0);
    expect(ref.ctx!.gains[5]!.gain.value).toBe(0);
  });

  it("driftGain target stays 0 when not drifting", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 30, throttle: 1, drifting: false });
    expect(ref.ctx!.gains[4]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("driftGain target stays 0 when drifting but speed<=7", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 5, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[4]!.gain.targets.at(-1)?.target).toBe(0);
    am.update(0.016, { speed: 7, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[4]!.gain.targets.at(-1)?.target).toBe(0);
  });

  it("driftGain target = driftGain when drifting && speed>7", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 20, throttle: 1, drifting: true });
    expect(ref.ctx!.gains[4]!.gain.targets.at(-1)?.target).toBeCloseTo(0.16, 5);
  });

  it("windGain target = 0 at speed 0", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 0, throttle: 0, drifting: false });
    expect(ref.ctx!.gains[5]!.gain.targets.at(-1)?.target).toBeCloseTo(0, 5);
  });

  it("windGain target rises to windGain (0.09) at maxSpeed", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.update(0.016, { speed: 34, throttle: 1, drifting: false });
    expect(ref.ctx!.gains[5]!.gain.targets.at(-1)?.target).toBeCloseTo(0.09, 5);
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
    const driftGain = ctx.gains[4]!;
    const windGain = ctx.gains[5]!;
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

describe("AudioManager — 2P per-player voices (008)", () => {
  it("default (1P) builds no StereoPanners", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    expect(ref.ctx!.stereoPanners).toHaveLength(0);
    am.dispose();
  });

  it("setHumanCount(2) before resume builds 2 StereoPanners panned -1/+1", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setHumanCount(2);
    am.resume();
    const ctx = ref.ctx!;
    expect(ctx.stereoPanners).toHaveLength(2);
    expect(ctx.stereoPanners[0]!.pan.value).toBe(-1);
    expect(ctx.stereoPanners[1]!.pan.value).toBe(1);
    am.dispose();
  });

  it("each panner connects to sfxBus; each voice routes through its panner", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setHumanCount(2);
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    const p0 = ctx.stereoPanners[0]!;
    const p1 = ctx.stereoPanners[1]!;
    expect(p0.connections).toContain(sfxBus);
    expect(p1.connections).toContain(sfxBus);
    // Voice 0 engine gain -> panner 0; voice 1 engine gain -> panner 1.
    // gains: [master, sfxBus, musicBus, v0Engine, v0Drift, v1Engine, v1Drift, wind]
    expect(ctx.gains[3]!.connections).toContain(p0);
    expect(ctx.gains[5]!.connections).toContain(p1);
    am.dispose();
  });

  it("updatePlayers drives each voice from its state + wind from max speed", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setHumanCount(2);
    am.resume();
    const ctx = ref.ctx!;
    am.updatePlayers(0.016, [
      { speed: 10, throttle: 0.5, drifting: false },
      { speed: 34, throttle: 1, drifting: true },
    ]);
    // voice 0 engine oscs follow speed 10; voice 1 follow speed 34.
    const v0 = engineCurve({ speed: 10, maxSpeed: 34, throttle: 0.5 }).freq;
    const v1 = engineCurve({ speed: 34, maxSpeed: 34, throttle: 1 }).freq;
    expect(ctx.oscillators[0]!.frequency.targets.at(-1)?.target).toBeCloseTo(v0, 1);
    expect(ctx.oscillators[4]!.frequency.targets.at(-1)?.target).toBeCloseTo(v1, 1);
    expect(v0).not.toBeCloseTo(v1, 1); // the two voices diverge
    // wind follows the max speed (34 -> full).
    const windGain = ctx.gains[7]!;
    expect(windGain.gain.targets.at(-1)?.target).toBeCloseTo(0.09, 5);
    am.dispose();
  });

  it("update (1P) delegates to updatePlayers with one state", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.update(0.016, { speed: 20, throttle: 1, drifting: false });
    // single voice engine oscs follow speed 20.
    expect(ctx.oscillators[0]!.frequency.targets.length).toBeGreaterThan(0);
    am.dispose();
  });
});
