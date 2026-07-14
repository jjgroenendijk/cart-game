import type { WeatherPreset } from "./weatherPresets";

/**
 * Per-preset channel targets (054 commit 3). `dim` scales sky light, `wind`
 * scales cloud drift, `wetness` is the terrain uWetness target. ALL existing
 * presets keep dim=1 + wind=1 so sky + clouds stay byte-identical; only
 * wetness is non-trivial (rain/snow wet the ground). The storm preset lands
 * in commit 4.
 */
export interface WeatherChannel {
  dim: number;
  windFactor: number;
  wetness: number;
}

/**
 * Per-frame channel values lerped by the weather envelope `level` so each
 * effect tracks the front's fade in/out. At level 0 every field is identity
 * (dimFactor 1, windFactor 1, wetness 0) so a fade-out fully reverts.
 */
export interface WeatherChannelLevel {
  dimFactor: number;
  windFactor: number;
  wetness: number;
}

/**
 * Preset -> channel targets. dim=1 + windFactor=1 for clear/rain/snow/fog =>
 * sky + clouds byte-identical; only wetness is non-trivial (rain full, snow
 * partial). The storm preset (dim<1, wind>1) comes in commit 4. warmRain is a
 * rain variant: full wetness (1), no dim (bright tropical sky), light wind
 * (1.1) matching its particle config windFactor. sandstorm/blizzard are
 * gale-force presets: faster cloud drift (windFactor 1.6/1.5) + a slight dim
 * (haze/whiteout), matching their particle windFactor + the weather-wind
 * audio bed (GameAudioDriver.updateWeather).
 */
export const WEATHER_CHANNELS: Readonly<Record<WeatherPreset, WeatherChannel>> = {
  clear: { dim: 1, windFactor: 1, wetness: 0 },
  rain: { dim: 1, windFactor: 1, wetness: 1 },
  snow: { dim: 1, windFactor: 1, wetness: 0.3 },
  fog: { dim: 1, windFactor: 1, wetness: 0 },
  sandstorm: { dim: 0.85, windFactor: 1.6, wetness: 0 },
  blizzard: { dim: 0.85, windFactor: 1.5, wetness: 0 },
  heatHaze: { dim: 1, windFactor: 1, wetness: 0 },
  aurora: { dim: 1, windFactor: 1, wetness: 0 },
  storm: { dim: 0.7, windFactor: 1.8, wetness: 1 },
  warmRain: { dim: 1, windFactor: 1.1, wetness: 1 },
};

/**
 * Resolve the live per-frame channel level for `preset` at envelope `level`
 * in [0,1]. Pure: same (preset, level) -> same result.
 *
 * Level 0 => identity (dimFactor 1, windFactor 1, wetness 0) so clear/fade-out
 * reverts fully. dimFactor lerps 1 -> dim, windFactor lerps 1 -> wind, wetness
 * scales 0 -> target. At level 1 the output equals the preset's channel.
 */
export function channelLevel(preset: WeatherPreset, level: number): WeatherChannelLevel {
  const ch = WEATHER_CHANNELS[preset];
  const l = Math.min(1, Math.max(0, level));
  return {
    dimFactor: 1 - (1 - ch.dim) * l,
    windFactor: 1 + (ch.windFactor - 1) * l,
    wetness: ch.wetness * l,
  };
}
