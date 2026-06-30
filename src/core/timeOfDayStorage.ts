/**
 * 042 versioned localStorage persistence for the time-of-day config v1.
 * Mirrors kartSelectionStorage.ts: every localStorage access is wrapped in
 * try/catch so a missing/corrupt/private-mode store never throws.
 * loadTimeOfDay falls back to DEFAULT_TIME_OF_DAY, saveTimeOfDay is a no-op on
 * failure. Pure except for localStorage I/O; timeOfDayConfig.ts owns all
 * validation. Uses a distinct key from the kart-selection and settings stores
 * so they never collide.
 */

import {
  DEFAULT_TIME_OF_DAY,
  validateTimeOfDayConfig,
  type TimeOfDayConfig,
} from "./timeOfDayConfig";

const STORAGE_KEY = "gamecart.timeOfDay.v1";
const SCHEMA_VERSION = 1;

interface StoredTimeOfDay {
  version: number;
  config: unknown;
}

/**
 * Load the persisted time-of-day config. Returns a fresh DEFAULT_TIME_OF_DAY
 * copy when the store is missing/corrupt or the schema version differs. Never
 * throws.
 */
export function loadTimeOfDay(): TimeOfDayConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_TIME_OF_DAY };
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredTimeOfDay).version === SCHEMA_VERSION
    ) {
      return validateTimeOfDayConfig((parsed as StoredTimeOfDay).config);
    }
    return { ...DEFAULT_TIME_OF_DAY };
  } catch {
    return { ...DEFAULT_TIME_OF_DAY };
  }
}

/**
 * Persist the time-of-day config under the v1 schema. Normalizes the input via
 * validateTimeOfDayConfig before writing so the store never holds an invalid
 * field. No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveTimeOfDay(config: TimeOfDayConfig): void {
  try {
    const payload: StoredTimeOfDay = {
      version: SCHEMA_VERSION,
      config: validateTimeOfDayConfig(config),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
