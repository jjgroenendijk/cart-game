/**
 * 054 versioned localStorage persistence for the weather config v1. Mirrors
 * timeOfDayStorage.ts: every localStorage access is wrapped in try/catch so a
 * missing/corrupt/private-mode store never throws. loadWeather falls back to
 * DEFAULT_WEATHER_MODE, saveWeather is a no-op on failure. Pure except for
 * localStorage I/O; weatherConfig.ts owns all validation. Uses a distinct key
 * from the time-of-day, kart-selection, and settings stores so they never
 * collide.
 */

import { DEFAULT_WEATHER_MODE, validateWeatherMode, type WeatherChoice } from "./weatherConfig";

const STORAGE_KEY = "gamecart.weather.v1";
const SCHEMA_VERSION = 1;

interface StoredWeather {
  version: number;
  mode: unknown;
}

/**
 * Load the persisted weather mode. Returns DEFAULT_WEATHER_MODE when the store
 * is missing/corrupt or the schema version differs. Never throws.
 */
export function loadWeather(): WeatherChoice {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_WEATHER_MODE;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredWeather).version === SCHEMA_VERSION
    ) {
      return validateWeatherMode((parsed as StoredWeather).mode);
    }
    return DEFAULT_WEATHER_MODE;
  } catch {
    return DEFAULT_WEATHER_MODE;
  }
}

/**
 * Persist the weather mode under the v1 schema. Normalizes the input via
 * validateWeatherMode before writing so the store never holds an invalid
 * value. No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveWeather(mode: WeatherChoice): void {
  try {
    const payload: StoredWeather = {
      version: SCHEMA_VERSION,
      mode: validateWeatherMode(mode),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
