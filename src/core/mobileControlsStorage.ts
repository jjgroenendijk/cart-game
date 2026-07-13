/**
 * Versioned localStorage persistence for the mobile control prefs (tilt
 * steering on/off + left-right invert). Mirrors circuitStorage.ts: every
 * access is wrapped in try/catch so a missing/corrupt/private-mode store never
 * throws. Uses a distinct key so it never collides with settings/circuit.
 *
 * The iOS DeviceOrientation permission itself is NOT persisted (it needs a
 * fresh user gesture each session); only the user's toggle intent is stored so
 * a returning player is offered tilt again on the first control tap.
 */

const STORAGE_KEY = "gamecart.mobileControls.v1";
const SCHEMA_VERSION = 1;

export interface MobileControlPrefs {
  /** User asked for accelerometer steering (permission still requested live). */
  tiltEnabled: boolean;
  /** Flip left/right for devices that report the opposite tilt sign. */
  invert: boolean;
}

export const DEFAULT_PREFS: MobileControlPrefs = { tiltEnabled: false, invert: false };

interface StoredPrefs {
  version: number;
  tiltEnabled: unknown;
  invert: unknown;
}

/** Load persisted prefs; returns a fresh DEFAULT_PREFS on miss/corrupt. Never throws. */
export function loadMobileControlPrefs(): MobileControlPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredPrefs).version === SCHEMA_VERSION
    ) {
      const stored = parsed as StoredPrefs;
      return {
        tiltEnabled: stored.tiltEnabled === true,
        invert: stored.invert === true,
      };
    }
    return { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs; no-op on failure (private mode / disabled storage). */
export function saveMobileControlPrefs(prefs: MobileControlPrefs): void {
  try {
    const payload: StoredPrefs = {
      version: SCHEMA_VERSION,
      tiltEnabled: prefs.tiltEnabled,
      invert: prefs.invert,
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore: persistence is best-effort
  }
}
