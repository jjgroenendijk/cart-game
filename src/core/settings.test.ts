import { describe, expect, it } from "vitest";
import { DEFAULTS, validateSettings, type SettingsState } from "./settings";

describe("settings (012)", () => {
  it("DEFAULTS has the v1 values (master 0.8, music 0.8, sfx 1.0, muted false)", () => {
    expect(DEFAULTS).toEqual({
      masterVolume: 0.8,
      musicVolume: 0.8,
      sfxVolume: 1.0,
      muted: false,
      positionalAudio: true,
      hrtf: false,
    });
  });

  it("returns DEFAULTS for non-object input (null, undefined, string, number)", () => {
    for (const bad of [null, undefined, "loud", 42, true, Number.NaN] as const) {
      expect(validateSettings(bad)).toEqual(DEFAULTS);
    }
  });

  it("clamps numeric fields to [0,1] (high, low, in-range)", () => {
    expect(validateSettings({ masterVolume: 1.5 }).masterVolume).toBe(1);
    expect(validateSettings({ masterVolume: -0.5 }).masterVolume).toBe(0);
    expect(validateSettings({ masterVolume: 0.3 }).masterVolume).toBe(0.3);
    expect(validateSettings({ sfxVolume: 2 }).sfxVolume).toBe(1);
    expect(validateSettings({ musicVolume: -1 }).musicVolume).toBe(0);
  });

  it("fills missing fields from DEFAULTS (partial object)", () => {
    expect(validateSettings({ masterVolume: 0.1 })).toEqual({
      masterVolume: 0.1,
      musicVolume: DEFAULTS.musicVolume,
      sfxVolume: DEFAULTS.sfxVolume,
      muted: DEFAULTS.muted,
      positionalAudio: DEFAULTS.positionalAudio,
      hrtf: DEFAULTS.hrtf,
    });
  });

  it("coerces a non-number numeric field to default, and non-boolean muted to false", () => {
    expect(validateSettings({ masterVolume: "loud" }).masterVolume).toBe(DEFAULTS.masterVolume);
    expect(validateSettings({ muted: "yes" }).muted).toBe(false);
    expect(validateSettings({ muted: 1 }).muted).toBe(false);
    expect(validateSettings({ muted: true }).muted).toBe(true);
  });

  it("coerces non-boolean positionalAudio/hrtf to defaults, passes real booleans", () => {
    expect(validateSettings({ positionalAudio: "yes" }).positionalAudio).toBe(
      DEFAULTS.positionalAudio,
    );
    expect(validateSettings({ hrtf: 1 }).hrtf).toBe(DEFAULTS.hrtf);
    const r = validateSettings({ positionalAudio: false, hrtf: true });
    expect(r.positionalAudio).toBe(false);
    expect(r.hrtf).toBe(true);
  });

  it("rejects NaN/Infinity -> default for that field", () => {
    expect(validateSettings({ masterVolume: NaN }).masterVolume).toBe(DEFAULTS.masterVolume);
    expect(validateSettings({ sfxVolume: Infinity }).sfxVolume).toBe(DEFAULTS.sfxVolume);
    expect(validateSettings({ musicVolume: -Infinity }).musicVolume).toBe(DEFAULTS.musicVolume);
  });

  it("returns a NEW object each call (no shared reference / mutation risk)", () => {
    const a = validateSettings({ masterVolume: 0.4 });
    a.masterVolume = 0;
    a.muted = true;
    const b = validateSettings({ masterVolume: 0.4 });
    expect(b.masterVolume).toBe(0.4);
    expect(b.muted).toBe(false);
    // Mutating the DEFAULTS object must not leak into a later call either.
    const c = validateSettings({ masterVolume: 0.7 });
    expect(c).not.toBe(a);
    expect(DEFAULTS.masterVolume).toBe(0.8);
  });

  it("drops unknown extra fields (result has exactly the 6 keys)", () => {
    const r = validateSettings({
      masterVolume: 0.5,
      extra: "leak",
      nested: { x: 1 },
    });
    expect(Object.keys(r).sort()).toEqual(
      ["hrtf", "masterVolume", "musicVolume", "muted", "positionalAudio", "sfxVolume"].sort(),
    );
    expect(r).toEqual({
      masterVolume: 0.5,
      musicVolume: DEFAULTS.musicVolume,
      sfxVolume: DEFAULTS.sfxVolume,
      muted: DEFAULTS.muted,
      positionalAudio: DEFAULTS.positionalAudio,
      hrtf: DEFAULTS.hrtf,
    } satisfies SettingsState);
  });
});
