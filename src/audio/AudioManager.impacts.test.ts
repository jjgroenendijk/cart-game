import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { makeMock } from "./mockAudioContext";

describe("AudioManager — collision impact trigger (009)", () => {
  it("triggerImpact before resume() is a no-op", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.triggerImpact(1000)).not.toThrow();
  });

  it("triggerImpact builds + fires the collision voice (env 0 -> peak -> 0)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    // collision env gain is the last gain after master/engine/drift/wind.
    const env = ctx.gains.at(-1)!;
    am.triggerImpact(1000);
    expect(env.gain.value).toBe(0); // setValueAtTime(0)
    expect(env.gain.ramps.length).toBe(2);
    expect(env.gain.ramps[0]!.value).toBeGreaterThan(0); // attack peak
    expect(env.gain.ramps[1]!.value).toBe(0); // decay tail
  });

  it("higher force yields a louder + brighter hit than a low force", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const lp = ctx.biquads.at(-1)!; // collision lowpass
    const env = ctx.gains.at(-1)!;

    am.triggerImpact(300); // low tier
    const lowPeak = env.gain.ramps[0]!.value;
    const lowCut = lp.frequency.value;

    am.triggerImpact(6000); // high tier (retrigger cancels prior env)
    const highPeak = env.gain.ramps[0]!.value;
    const highCut = lp.frequency.value;

    expect(highPeak).toBeGreaterThan(lowPeak);
    expect(highCut).toBeGreaterThan(lowCut);
  });

  it("the collision voice routes into the sfx bus", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    const env = ctx.gains.at(-1)!;
    expect(env.connections).toContain(sfxBus);
  });

  it("dispose stops + disconnects the collision voice", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const src = ctx.bufferSources.at(-1)!; // collision source
    const lp = ctx.biquads.at(-1)!;
    const env = ctx.gains.at(-1)!;
    am.dispose();
    expect(src.stopped).toBe(true);
    expect(src.disconnects).toBeGreaterThanOrEqual(1);
    expect(lp.disconnects).toBeGreaterThanOrEqual(1);
    expect(env.disconnects).toBeGreaterThanOrEqual(1);
  });
});
