/**
 * 012 settings v1 state. Pure (no DOM, no imports) so it runs under jsdom.
 * Owns the SettingsState shape, the v1 defaults, and validateSettings, which
 * normalizes any unknown input into a clean SettingsState (clamped + filled
 * from DEFAULTS, no extras). storage.ts + SettingsOverlay consume these.
 */

/**
 * 159 per-effect toggles for the analytic sun light effects. Each flips one
 * effect on/off independently; strength per tier lives in quality.ts. Lens
 * flare defaults OFF (a "camera" artifact the flat cel look does not always
 * want); the two atmospheric effects default ON.
 */
export interface EffectSettings {
  sunHalo: boolean;
  godRays: boolean;
  lensFlare: boolean;
}

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  positionalAudio: boolean;
  hrtf: boolean;
  effects: EffectSettings;
}

/**
 * v1 defaults. masterVolume mirrors AudioManager DEFAULT_VOLUME (:97); music
 * is the same level; sfx stays at full (1.0); muted off. Sun halo + god rays
 * on, lens flare off by default.
 */
export const DEFAULTS: SettingsState = {
  masterVolume: 0.8,
  musicVolume: 0.8,
  sfxVolume: 1.0,
  muted: false,
  positionalAudio: true,
  hrtf: false,
  effects: { sunHalo: true, godRays: true, lensFlare: false },
};

/** Clamp a finite number to [0,1]; otherwise return null. */
function clamp01OrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : null;
}

/** Read one boolean field from a source, falling back to the default. */
function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Coerce any input into a clean EffectSettings (each flag boolean-or-default). */
function validateEffects(input: unknown): EffectSettings {
  const src = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const d = DEFAULTS.effects;
  return {
    sunHalo: boolOr(src.sunHalo, d.sunHalo),
    godRays: boolOr(src.godRays, d.godRays),
    lensFlare: boolOr(src.lensFlare, d.lensFlare),
  };
}

/**
 * Coerce any input into a valid SettingsState. Never throws. Non-object or
 * null/undefined -> fresh DEFAULTS copy. Numeric fields are clamped to [0,1]
 * (NaN/Infinity -> default); the booleans (muted, positionalAudio, hrtf) fall
 * back to DEFAULTS unless boolean; `effects` is normalized field-by-field. The
 * result always carries exactly the known fields, so no stray keys leak. No
 * schema-version bump: old v1 stores load + default positionalAudio/hrtf/effects.
 */
export function validateSettings(input: unknown): SettingsState {
  if (input === null || typeof input !== "object") return { ...DEFAULTS };
  const src = input as Record<string, unknown>;
  const master = clamp01OrNull(src.masterVolume);
  const music = clamp01OrNull(src.musicVolume);
  const sfx = clamp01OrNull(src.sfxVolume);
  const muted = typeof src.muted === "boolean" ? src.muted : DEFAULTS.muted;
  const positionalAudio =
    typeof src.positionalAudio === "boolean" ? src.positionalAudio : DEFAULTS.positionalAudio;
  const hrtf = typeof src.hrtf === "boolean" ? src.hrtf : DEFAULTS.hrtf;
  return {
    masterVolume: master === null ? DEFAULTS.masterVolume : master,
    musicVolume: music === null ? DEFAULTS.musicVolume : music,
    sfxVolume: sfx === null ? DEFAULTS.sfxVolume : sfx,
    muted,
    positionalAudio,
    hrtf,
    effects: validateEffects(src.effects),
  };
}
