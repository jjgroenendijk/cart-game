import { describe, expect, it } from "vitest";
import { AudioManager } from "./AudioManager";
import { makeMock } from "./mockAudioContext";

describe("AudioManager — music + sfx bus gains (012)", () => {
  it("setSfxVolume/setMusicVolume are no-ops before resume()", () => {
    const am = new AudioManager({ createContext: () => null, attachVisibility: false });
    expect(() => am.setSfxVolume(0.5)).not.toThrow();
    expect(() => am.setMusicVolume(0.5)).not.toThrow();
    expect(am.isRunning).toBe(false);
  });

  it("resume() builds sfxBus + musicBus, both feeding master, default gain 1.0", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const master = ctx.gains[0]!;
    const sfxBus = ctx.gains[1]!;
    const musicBus = ctx.gains[2]!;
    expect(sfxBus.gain.value).toBe(1);
    expect(musicBus.gain.value).toBe(1);
    // each bus connects into master (sfxBus.connect(master), etc.)
    expect(sfxBus.connections).toContain(master);
    expect(musicBus.connections).toContain(master);
    am.dispose();
  });

  it("setSfxVolume ramps sfxBus only (musicBus target unchanged)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    const musicBus = ctx.gains[2]!;
    am.setSfxVolume(0.3);
    expect(sfxBus.gain.targets.at(-1)?.target).toBeCloseTo(0.3, 5);
    expect(musicBus.gain.targets.at(-1)?.target).not.toBeCloseTo(0.3, 5);
    am.dispose();
  });

  it("setMusicVolume ramps musicBus only (sfxBus target unchanged)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    const musicBus = ctx.gains[2]!;
    am.setMusicVolume(0.4);
    expect(musicBus.gain.targets.at(-1)?.target).toBeCloseTo(0.4, 5);
    expect(sfxBus.gain.targets.at(-1)?.target).not.toBeCloseTo(0.4, 5);
    am.dispose();
  });

  it("mute(true) drives master to 0 (both buses feed master -> all silent)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.resume();
    const master = ref.ctx!.gains[0]!;
    am.mute(true);
    expect(master.gain.targets.at(-1)?.target).toBe(0);
    am.dispose();
  });

  it("pre-resume setSfxVolume applies on resume (boots at stored level)", () => {
    const { factory, ref } = makeMock();
    const am = new AudioManager({ createContext: factory, attachVisibility: false });
    am.setSfxVolume(0.2);
    am.setMusicVolume(0.6);
    am.resume();
    const ctx = ref.ctx!;
    const sfxBus = ctx.gains[1]!;
    const musicBus = ctx.gains[2]!;
    expect(sfxBus.gain.targets.at(-1)?.target).toBeCloseTo(0.2, 5);
    expect(musicBus.gain.targets.at(-1)?.target).toBeCloseTo(0.6, 5);
    am.dispose();
  });
});
