/**
 * 054 pure weather-mode config. Owns the auto + every WeatherPreset choice
 * the race-config overlay exposes, plus validateWeatherMode, which normalizes
 * any input into a safe WeatherChoice (bad fields fall back to "auto", never
 * throws). Mirrors timeOfDayConfig.ts (mode/phase/speed) and the settings/
 * kartSelection split. Pure (no DOM, no localStorage); weatherStorage.ts
 * persists it. WeatherChoice maps 1:1 onto Environment.setWeatherMode's
 * WeatherMode (auto | WeatherPreset). Kept in {@link WeatherPreset}'s
 * PRESET_ORDER so every preset is manually selectable, not just the biome-
 * reachable ones.
 */

export const WEATHER_MODE_VALUES = [
  "auto",
  "clear",
  "rain",
  "snow",
  "fog",
  "sandstorm",
  "blizzard",
  "heatHaze",
  "aurora",
  "storm",
  "warmRain",
] as const;
export type WeatherChoice = (typeof WEATHER_MODE_VALUES)[number];

export const WEATHER_MODE_LABELS = [
  "AUTO",
  "CLEAR",
  "RAIN",
  "SNOW",
  "FOG",
  "SANDSTORM",
  "BLIZZARD",
  "HEAT HAZE",
  "AURORA",
  "STORM",
  "WARM RAIN",
];

export const DEFAULT_WEATHER_MODE: WeatherChoice = "auto";

const VALID_MODES: ReadonlySet<WeatherChoice> = new Set(WEATHER_MODE_VALUES);

/**
 * Validate + normalize unknown input to a safe WeatherChoice. Returns a fresh
 * default "auto" for non-string/unknown values and accepts only the 5
 * WEATHER_MODE_VALUES. Never throws.
 */
export function validateWeatherMode(input: unknown): WeatherChoice {
  return typeof input === "string" && VALID_MODES.has(input as WeatherChoice)
    ? (input as WeatherChoice)
    : DEFAULT_WEATHER_MODE;
}
