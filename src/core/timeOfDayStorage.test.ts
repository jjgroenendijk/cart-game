import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIME_OF_DAY } from "./timeOfDayConfig";
import { loadTimeOfDay, saveTimeOfDay } from "./timeOfDayStorage";

const STORAGE_KEY = "gamecart.timeOfDay.v1";

/**
 * Minimal in-memory Storage shim (see storage.test.ts for rationale):
 * vitest/jsdom does not expose a usable global localStorage, so tests stub a
 * Storage-like object onto globalThis.localStorage. timeOfDayStorage.ts reads
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

describe("timeOfDayStorage (042)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadTimeOfDay returns DEFAULT_TIME_OF_DAY when nothing is stored", () => {
    expect(loadTimeOfDay()).toEqual(DEFAULT_TIME_OF_DAY);
  });

  it("saveTimeOfDay then loadTimeOfDay round-trips the config", () => {
    saveTimeOfDay({ mode: "static", phase: "night", dayLengthSeconds: 60 });
    expect(loadTimeOfDay()).toEqual({ mode: "static", phase: "night", dayLengthSeconds: 60 });
  });

  it("loadTimeOfDay returns DEFAULT_TIME_OF_DAY on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadTimeOfDay()).not.toThrow();
    expect(loadTimeOfDay()).toEqual(DEFAULT_TIME_OF_DAY);
  });

  it("loadTimeOfDay returns DEFAULT_TIME_OF_DAY on a wrong schema version", () => {
    const payload = JSON.stringify({
      version: 99,
      config: { mode: "static", phase: "night", dayLengthSeconds: 60 },
    });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadTimeOfDay()).toEqual(DEFAULT_TIME_OF_DAY);
  });

  it("saveTimeOfDay normalizes invalid fields on save", () => {
    saveTimeOfDay({ mode: "static", phase: "oops", dayLengthSeconds: 60 } as unknown as never);
    expect(loadTimeOfDay()).toEqual({
      mode: "static",
      phase: "morning",
      dayLengthSeconds: 60,
    });
  });

  it("loadTimeOfDay returns DEFAULT_TIME_OF_DAY when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadTimeOfDay()).not.toThrow();
    expect(loadTimeOfDay()).toEqual(DEFAULT_TIME_OF_DAY);
  });

  it("saveTimeOfDay is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() =>
      saveTimeOfDay({ mode: "static", phase: "night", dayLengthSeconds: 60 }),
    ).not.toThrow();
  });

  it("saveTimeOfDay writes a versioned payload under the storage key", () => {
    saveTimeOfDay({ mode: "static", phase: "night", dayLengthSeconds: 60 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; config: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.config).toEqual({ mode: "static", phase: "night", dayLengthSeconds: 60 });
  });
});
