import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEATHER_MODE,
  WEATHER_MODE_VALUES,
  validateWeatherMode,
  type WeatherChoice,
} from "./weatherConfig";

describe("weatherConfig (054)", () => {
  it("validateWeatherMode accepts every WEATHER_MODE_VALUES entry", () => {
    for (const mode of WEATHER_MODE_VALUES) {
      expect(validateWeatherMode(mode)).toBe(mode);
    }
  });

  it("validateWeatherMode returns DEFAULT_WEATHER_MODE (auto) for unknown strings", () => {
    expect(validateWeatherMode("hurricane")).toBe(DEFAULT_WEATHER_MODE);
    expect(validateWeatherMode("")).toBe(DEFAULT_WEATHER_MODE);
  });

  it("validateWeatherMode returns DEFAULT_WEATHER_MODE for non-strings", () => {
    expect(validateWeatherMode(null)).toBe(DEFAULT_WEATHER_MODE);
    expect(validateWeatherMode(undefined)).toBe(DEFAULT_WEATHER_MODE);
    expect(validateWeatherMode(42)).toBe(DEFAULT_WEATHER_MODE);
    expect(validateWeatherMode({ mode: "rain" })).toBe(DEFAULT_WEATHER_MODE);
    expect(validateWeatherMode(["rain"])).toBe(DEFAULT_WEATHER_MODE);
  });

  it("DEFAULT_WEATHER_MODE is auto", () => {
    const auto: WeatherChoice = DEFAULT_WEATHER_MODE;
    expect(auto).toBe("auto");
  });
});
