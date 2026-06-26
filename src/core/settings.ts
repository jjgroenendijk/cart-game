/**
 * 012 settings v1 state. Pure (no DOM, no imports) so it runs under jsdom.
 * Owns the SettingsState shape, the v1 defaults, and validateSettings, which
 * normalizes any unknown input into a clean SettingsState (clamped + filled
 * from DEFAULTS, no extras). storage.ts + SettingsOverlay consume these.
 */

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  positionalAudio: boolean;
  hrtf: boolean;
}

/**
 * v1 defaults. masterVolume mirrors AudioManager DEFAULT_VOLUME (:97); music
 * is the same level; sfx stays at full (1.0); muted off.
 */
export const DEFAULTS: SettingsState = {
  masterVolume: 0.8,
  musicVolume: 0.8,
  sfxVolume: 1.0,
  muted: false,
  positionalAudio: true,
  hrtf: false,
};

/** Clamp a finite number to [0,1]; otherwise return null. */
function clamp01OrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : null;
}

/**
 * Coerce any input into a valid SettingsState. Never throws. Non-object or
 * null/undefined -> fresh DEFAULTS copy. Numeric fields are clamped to [0,1]
 * (NaN/Infinity -> default); the booleans (muted, positionalAudio, hrtf) fall
 * back to DEFAULTS unless boolean. The result always carries exactly the six
 * fields, so no stray keys leak. No schema-version bump: old v1 stores load +
 * default positionalAudio/hrtf.
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
  };
}
