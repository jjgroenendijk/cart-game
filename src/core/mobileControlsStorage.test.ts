import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFS,
  loadMobileControlPrefs,
  saveMobileControlPrefs,
} from "./mobileControlsStorage";

const KEY = "gamecart.mobileControls.v1";

/** In-memory Storage shim; vitest/node has no usable global localStorage. */
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear: () => store.clear(),
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

describe("mobileControlsStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns defaults when the store is empty", () => {
    expect(loadMobileControlPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("round-trips saved prefs", () => {
    saveMobileControlPrefs({ tiltEnabled: true, invert: true });
    expect(loadMobileControlPrefs()).toEqual({ tiltEnabled: true, invert: true });
  });

  it("returns defaults when localStorage is undefined (no throw)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadMobileControlPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadMobileControlPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("falls back to defaults on a version mismatch", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 99, tiltEnabled: true, invert: true }));
    expect(loadMobileControlPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("coerces non-boolean stored fields to false", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, tiltEnabled: "yes", invert: 1 }));
    expect(loadMobileControlPrefs()).toEqual({ tiltEnabled: false, invert: false });
  });
});
