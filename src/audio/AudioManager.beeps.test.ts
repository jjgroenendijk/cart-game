import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { makeMock } from "./mockAudioContext";

describe("AudioManager — UI beeps", () => {
  it("uiBeep before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.uiBeep("click")).not.toThrow();
  });

  it("uiBeep creates osc + gain, wires osc -> gain -> sfxBus, starts + stops", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const oscsBefore = ctx.oscillators.length;
    const gainsBefore = ctx.gains.length;
    am.uiBeep("beep");
    const osc = ctx.oscillators[oscsBefore]!;
    const gain = ctx.gains[gainsBefore]!;
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(true);
    expect(osc.connections).toContain(gain);
    expect(gain.connections).toContain(ctx.gains[1]); // sfxBus
  });

  it("envelope ramps 0 -> peak -> 0 via linearRampToValueAtTime", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.uiBeep("beep"); // peak 0.22, dur 0.16
    const gain = ctx.gains[ctx.gains.length - 1]!;
    // setValueAtTime(0) first, then ramp to peak, then ramp to 0.
    expect(gain.gain.value).toBe(0);
    expect(gain.gain.ramps.length).toBe(2);
    expect(gain.gain.ramps[0]!.value).toBeCloseTo(0.22, 5);
    expect(gain.gain.ramps[1]!.value).toBe(0);
  });

  it("each kind maps to its freq + oscillator type", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const cases: { kind: "hover" | "click" | "beep" | "go"; freq: number; type: OscillatorType }[] =
      [
        { kind: "hover", freq: 880, type: "sine" },
        { kind: "click", freq: 520, type: "triangle" },
        { kind: "beep", freq: 660, type: "sine" },
        { kind: "go", freq: 990, type: "sine" },
      ];
    for (const c of cases) {
      const oscsBefore = ctx.oscillators.length;
      am.uiBeep(c.kind);
      const osc = ctx.oscillators[oscsBefore]!;
      expect(osc.type).toBe(c.type);
      expect(osc.frequency.value).toBe(c.freq);
    }
  });

  it("onended disconnects osc + gain (no node leak)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    am.uiBeep("click");
    const osc = ctx.oscillators[ctx.oscillators.length - 1]!;
    const gain = ctx.gains[ctx.gains.length - 1]!;
    expect(osc.disconnects).toBe(0);
    expect(gain.disconnects).toBe(0);
    osc.onended!();
    expect(osc.disconnects).toBe(1);
    expect(gain.disconnects).toBe(1);
  });
});
