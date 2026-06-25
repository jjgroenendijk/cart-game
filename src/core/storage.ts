/**
 * 012 versioned localStorage persistence for settings v1. Wraps every
 * localStorage access in try/catch so a missing/corrupt/private-mode store
 * never throws: loadSettings falls back to DEFAULTS, saveSettings is a no-op.
 * Pure except for localStorage I/O; settings.ts owns all validation.
 */

import { DEFAULTS, validateSettings, type SettingsState } from "./settings";

const STORAGE_KEY = "gamecart.settings.v1";
const SCHEMA_VERSION = 1;

interface StoredSettings {
  version: number;
  settings: SettingsState;
}

/**
 * Load settings from localStorage. Returns a fresh DEFAULTS copy when the
 * store is missing/corrupt or the schema version differs. Never throws.
 */
export function loadSettings(): SettingsState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredSettings).version === SCHEMA_VERSION
    ) {
      return validateSettings((parsed as StoredSettings).settings);
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist settings under the v1 schema. No-op (swallow) when localStorage is
 * unavailable or quota/private-mode rejects the write. Never throws.
 */
export function saveSettings(settings: SettingsState): void {
  try {
    const payload: StoredSettings = {
      version: SCHEMA_VERSION,
      settings: validateSettings(settings),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
