import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { makeMock, type MockGain } from "./mockAudioContext";

const RAIN_GAIN = 0.12;
const THUNDER_CUTOFF_HZ = 400;
const THUNDER_DECAY_SEC = 1.2;

describe("AudioManager — rain bed (054 commit 4)", () => {
  it("setRainLevel before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.setRainLevel(1)).not.toThrow();
    expect(am.isRunning).toBe(false);
  });

  it("resume() builds a looping rain source -> bandpass -> rainGain -> sfxBus", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    // rain bandpass = the bandpass at ~1000Hz (drift is 1500Hz).
    const rainBand = ctx.biquads.find((b) => b.type === "bandpass" && b.frequency.value === 1000)!;
    expect(rainBand).toBeDefined();
    expect(rainBand.Q.value).toBeCloseTo(0.7, 5);
    // rainGain is the gain the bandpass feeds; it connects to sfxBus.
    const rainGain = rainBand.connections.find(
      (c) => "gain" in c && (c as MockGain).connections.includes(sfxBus),
    ) as MockGain | undefined;
    expect(rainGain).toBeDefined();
    expect(rainGain!.gain.value).toBe(0); // silent at rest
    expect(rainGain!.connections).toContain(sfxBus);
    am.dispose();
  });

  it("setRainLevel(1) ramps rainGain to RAIN_GAIN; 0.5 -> half", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.setRainLevel(1);
    const rainGain = ref.ctx!.gains.find(
      (g) => Math.abs((g.gain.targets.at(-1)?.target ?? -999) - RAIN_GAIN) < 1e-6,
    )!;
    expect(rainGain).toBeDefined();
    am.setRainLevel(0.5);
    expect(rainGain.gain.targets.at(-1)?.target).toBeCloseTo(RAIN_GAIN * 0.5, 5);
    am.dispose();
  });

  it("setRainLevel clamps >1 to 1 and <0 to 0", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    am.setRainLevel(2);
    const rainGain = ref.ctx!.gains.find(
      (g) => Math.abs((g.gain.targets.at(-1)?.target ?? -999) - RAIN_GAIN) < 1e-6,
    )!;
    expect(rainGain).toBeDefined();
    am.setRainLevel(-1);
    expect(rainGain.gain.targets.at(-1)?.target).toBe(0);
    am.dispose();
  });
});

describe("AudioManager — thunder one-shot (054 commit 4)", () => {
  it("thunder before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.thunder(0.8, 2)).not.toThrow();
    expect(am.isRunning).toBe(false);
  });

  it("thunder schedules a source + envelope at currentTime + delay", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sourcesBefore = ctx.bufferSources.length;
    const delay = 2.5;
    const strength = 0.8;
    am.thunder(strength, delay);
    // one transient source created per call (looping rumble).
    expect(ctx.bufferSources.length).toBe(sourcesBefore + 1);
    const src = ctx.bufferSources[sourcesBefore]!;
    expect(src.loop).toBe(true);
    expect(src.started).toBe(true);
    // env gain is the last gain; attack ramp lands at (currentTime+delay)+0.05.
    const gain = ctx.gains.at(-1)!;
    expect(gain.gain.ramps.length).toBe(2);
    expect(gain.gain.ramps[0]!.value).toBeCloseTo(strength * 0.5, 5);
    expect(gain.gain.ramps[0]!.time).toBeCloseTo(delay + 0.05, 5);
    expect(gain.gain.ramps[1]!.value).toBe(0);
    expect(gain.gain.ramps[1]!.time).toBeCloseTo(delay + THUNDER_DECAY_SEC, 5);
    am.dispose();
  });

  it("thunder routes noise -> lowpass(400Hz) -> gain -> sfxBus", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    am.thunder(0.6, 1);
    const gain = ctx.gains.at(-1)!;
    expect(gain.connections).toContain(sfxBus);
    // the lowpass feeding the gain is a 400Hz lowpass.
    const lp = ctx.biquads.find(
      (b) =>
        b.type === "lowpass" &&
        b.frequency.value === THUNDER_CUTOFF_HZ &&
        b.connections.includes(gain),
    );
    expect(lp).toBeDefined();
    am.dispose();
  });
});
