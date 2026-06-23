import { describe, expect, it } from "vitest";
import { MockAudioContext, MockGain } from "./mockAudioContext";
import { cueSpec, playRespawnCue, DEFAULT_RESPAWN } from "./respawnCue";

describe("cueSpec (pure)", () => {
  it("returns the defaults when no overrides given", () => {
    const s = cueSpec();
    expect(s).toEqual(DEFAULT_RESPAWN);
    expect(s.fromHz).toBeGreaterThan(s.toHz); // descending
  });

  it("merges partial overrides and keeps the rest default", () => {
    const s = cueSpec({ fromHz: 880, decay: 0.3 });
    expect(s.fromHz).toBe(880);
    expect(s.decay).toBe(0.3);
    expect(s.toHz).toBe(DEFAULT_RESPAWN.toHz);
    expect(s.peak).toBe(DEFAULT_RESPAWN.peak);
  });
});

describe("playRespawnCue", () => {
  it("builds an osc + gain, wires osc -> gain -> destination", () => {
    const ctx = new MockAudioContext();
    const dest = ctx.createGain();
    const oscsBefore = ctx.oscillators.length;
    const gainsBefore = ctx.gains.length;
    playRespawnCue(ctx as unknown as AudioContext, dest as unknown as AudioNode, 1.0);
    const osc = ctx.oscillators[oscsBefore]!;
    const gain = ctx.gains[gainsBefore]!;
    expect(osc.type).toBe("sine");
    expect(osc.connections).toContain(gain);
    expect(gain.connections).toContain(dest);
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(true);
  });

  it("glides 660Hz -> 220Hz exponentially over decay", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    playRespawnCue(ctx as unknown as AudioContext, dest as unknown as AudioNode, 2.0);
    const osc = ctx.oscillators[0]!;
    expect(osc.frequency.value).toBe(660); // setValueAtTime
    expect(osc.frequency.expRamps.length).toBe(1);
    expect(osc.frequency.expRamps[0]!.value).toBe(220);
    expect(osc.frequency.expRamps[0]!.time).toBeCloseTo(2.0 + DEFAULT_RESPAWN.decay, 5);
  });

  it("envelope ramps 0 -> peak -> 0", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    playRespawnCue(ctx as unknown as AudioContext, dest as unknown as AudioNode, 0);
    const gain = ctx.gains[1]!; // [0] = caller's dest, [1] = the cue env gain
    expect(gain.gain.value).toBe(0);
    expect(gain.gain.ramps.length).toBe(2);
    expect(gain.gain.ramps[0]!.value).toBeCloseTo(DEFAULT_RESPAWN.peak, 5);
    expect(gain.gain.ramps[1]!.value).toBe(0);
  });

  it("stops the osc at decay and self-cleans via onended", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    playRespawnCue(ctx as unknown as AudioContext, dest as unknown as AudioNode, 0);
    const osc = ctx.oscillators[0]!;
    const gain = ctx.gains[1]!;
    expect(osc.stopped).toBe(true);
    expect(osc.disconnects).toBe(0);
    expect(gain.disconnects).toBe(0);
    osc.onended!();
    expect(osc.disconnects).toBe(1);
    expect(gain.disconnects).toBe(1);
  });
});
