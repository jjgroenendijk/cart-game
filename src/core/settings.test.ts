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
      effects: {
        sunHalo: true,
        godRays: true,
        lensFlare: false,
        groundMist: true,
        ambientOcclusion: true,
      },
      tilt: { enabled: true, sensitivity: 1, invert: false },
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
      effects: DEFAULTS.effects,
      tilt: DEFAULTS.tilt,
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

  it("drops unknown extra fields (result has exactly the known keys)", () => {
    const r = validateSettings({
      masterVolume: 0.5,
      extra: "leak",
      nested: { x: 1 },
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        "effects",
        "hrtf",
        "masterVolume",
        "musicVolume",
        "muted",
        "positionalAudio",
        "sfxVolume",
        "tilt",
      ].sort(),
    );
    expect(r).toEqual({
      masterVolume: 0.5,
      musicVolume: DEFAULTS.musicVolume,
      sfxVolume: DEFAULTS.sfxVolume,
      muted: DEFAULTS.muted,
      positionalAudio: DEFAULTS.positionalAudio,
      hrtf: DEFAULTS.hrtf,
      effects: DEFAULTS.effects,
      tilt: DEFAULTS.tilt,
    } satisfies SettingsState);
  });

  it("normalizes the effects sub-state field-by-field (coerce + fill)", () => {
    const r = validateSettings({
      effects: { sunHalo: false, godRays: "yes", extra: 1 },
    });
    expect(r.effects).toEqual({
      sunHalo: false, // real boolean kept
      godRays: DEFAULTS.effects.godRays, // non-boolean -> default
      lensFlare: DEFAULTS.effects.lensFlare, // missing -> default
      groundMist: DEFAULTS.effects.groundMist, // missing -> default
      ambientOcclusion: DEFAULTS.effects.ambientOcclusion, // missing -> default
    });
    // A non-object effects field falls back to all defaults.
    expect(validateSettings({ effects: "bad" }).effects).toEqual(DEFAULTS.effects);
    expect(validateSettings({}).effects).toEqual(DEFAULTS.effects);
  });

  it("does not share the effects object reference across calls", () => {
    const a = validateSettings({ masterVolume: 0.5 });
    a.effects.sunHalo = false;
    expect(validateSettings({ masterVolume: 0.5 }).effects.sunHalo).toBe(true);
    expect(DEFAULTS.effects.sunHalo).toBe(true);
  });

  it("normalizes the tilt sub-state (booleans coerced, sensitivity clamped)", () => {
    const r = validateSettings({
      tilt: { enabled: false, sensitivity: 9, invert: "yes", extra: 1 },
    });
    expect(r.tilt).toEqual({ enabled: false, sensitivity: 2.5, invert: false });
    expect(validateSettings({ tilt: { sensitivity: -3 } }).tilt.sensitivity).toBe(0.3);
    expect(validateSettings({ tilt: { sensitivity: "fast" } }).tilt.sensitivity).toBe(1);
    // A non-object tilt field falls back to all defaults.
    expect(validateSettings({ tilt: "bad" }).tilt).toEqual(DEFAULTS.tilt);
    expect(validateSettings({}).tilt).toEqual(DEFAULTS.tilt);
  });

  it("does not share the tilt object reference across calls", () => {
    const a = validateSettings({ masterVolume: 0.5 });
    a.tilt.enabled = false;
    expect(validateSettings({ masterVolume: 0.5 }).tilt.enabled).toBe(true);
    expect(DEFAULTS.tilt.enabled).toBe(true);
  });
});
