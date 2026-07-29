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
 * 228 groundMist defaults ON (an atmosphere effect, not a camera artifact).
 * 235 ambientOcclusion defaults ON (a realism effect, not a camera artifact).
 */
export interface EffectSettings {
  sunHalo: boolean;
  godRays: boolean;
  lensFlare: boolean;
  /** 228 valley ground-mist post pass toggle (atmosphere effect; default ON). */
  groundMist: boolean;
  /** 235 GTAO ambient occlusion post pass toggle (a realism effect; default ON). */
  ambientOcclusion: boolean;
}

/**
 * Mobile tilt-steering settings. `enabled` arms the device-orientation path at
 * all; `sensitivity` scales the response; `invert` flips the steer sign for
 * devices/orientations that report it reversed. Structurally matches
 * `TiltConfig` in deviceInput.ts (kept inline here so settings stays import-free
 * and DOM/THREE-free for jsdom). Only meaningful on touch devices.
 */
export interface TiltSettings {
  enabled: boolean;
  sensitivity: number;
  invert: boolean;
}

/** Sensitivity slider bounds, shared with the SettingsOverlay tilt row. */
export const TILT_SENSITIVITY_MIN = 0.3;
export const TILT_SENSITIVITY_MAX = 2.5;

export interface SettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  positionalAudio: boolean;
  hrtf: boolean;
  effects: EffectSettings;
  tilt: TiltSettings;
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
  effects: {
    sunHalo: true,
    godRays: true,
    lensFlare: false,
    groundMist: true,
    ambientOcclusion: true,
  },
  tilt: { enabled: true, sensitivity: 1, invert: false },
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
    groundMist: boolOr(src.groundMist, d.groundMist),
    ambientOcclusion: boolOr(src.ambientOcclusion, d.ambientOcclusion),
  };
}

/** Coerce any input into a clean TiltSettings (booleans + clamped sensitivity). */
function validateTilt(input: unknown): TiltSettings {
  const src = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const d = DEFAULTS.tilt;
  const s = typeof src.sensitivity === "number" && Number.isFinite(src.sensitivity);
  const sensitivity = s
    ? Math.min(TILT_SENSITIVITY_MAX, Math.max(TILT_SENSITIVITY_MIN, src.sensitivity as number))
    : d.sensitivity;
  return {
    enabled: boolOr(src.enabled, d.enabled),
    sensitivity,
    invert: boolOr(src.invert, d.invert),
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
    tilt: validateTilt(src.tilt),
  };
}
