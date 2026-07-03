import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WEATHER_MODE } from "./weatherConfig";
import { loadWeather, saveWeather } from "./weatherStorage";

const STORAGE_KEY = "gamecart.weather.v1";

/**
 * Minimal in-memory Storage shim (see timeOfDayStorage.test.ts for rationale):
 * vitest/jsdom does not expose a usable global localStorage, so tests stub a
 * Storage-like object onto globalThis.localStorage. weatherStorage.ts reads
 * it via globalThis.localStorage, so this exercises the real code path.
 */
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
    key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string): void => {
      store.delete(k);
    },
    setItem: (k: string, v: string): void => {
      store.set(k, String(v));
    },
  };
}

describe("weatherStorage (054)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadWeather returns DEFAULT_WEATHER_MODE when nothing is stored", () => {
    expect(loadWeather()).toBe(DEFAULT_WEATHER_MODE);
  });

  it("saveWeather then loadWeather round-trips the mode", () => {
    saveWeather("storm");
    expect(loadWeather()).toBe("storm");
  });

  it("loadWeather returns DEFAULT_WEATHER_MODE on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadWeather()).not.toThrow();
    expect(loadWeather()).toBe(DEFAULT_WEATHER_MODE);
  });

  it("loadWeather returns DEFAULT_WEATHER_MODE on a wrong schema version", () => {
    const payload = JSON.stringify({ version: 99, mode: "rain" });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadWeather()).toBe(DEFAULT_WEATHER_MODE);
  });

  it("saveWeather normalizes an invalid mode on save", () => {
    saveWeather("hurricane" as never);
    expect(loadWeather()).toBe(DEFAULT_WEATHER_MODE);
  });

  it("loadWeather returns DEFAULT_WEATHER_MODE when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadWeather()).not.toThrow();
    expect(loadWeather()).toBe(DEFAULT_WEATHER_MODE);
  });

  it("saveWeather is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveWeather("snow")).not.toThrow();
  });

  it("saveWeather writes a versioned payload under the storage key", () => {
    saveWeather("rain");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; mode: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.mode).toBe("rain");
  });
});
