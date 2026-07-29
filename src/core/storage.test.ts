import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "./settings";
import { loadSettings, saveSettings } from "./storage";

const STORAGE_KEY = "gamecart.settings.v1";

/**
 * Minimal in-memory Storage shim. This vitest/jsdom build (Node 26) does not
 * expose a usable global localStorage (jsdom opaque origin + Node's
 * experimental getter shadow it), so tests stub a Storage-like object onto
 * globalThis.localStorage. storage.ts reads it via globalThis.localStorage,
 * so this exercises the real code path.
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

describe("storage (012)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadSettings returns DEFAULTS when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("saveSettings then loadSettings round-trips the values", () => {
    const s = {
      masterVolume: 0.25,
      musicVolume: 0.5,
      sfxVolume: 0.75,
      muted: true,
      positionalAudio: true,
      hrtf: false,
      effects: {
        sunHalo: false,
        godRays: true,
        lensFlare: true,
        groundMist: true,
        ambientOcclusion: true,
      },
      tilt: { enabled: false, sensitivity: 1.5, invert: true },
    };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("loadSettings returns DEFAULTS on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("loadSettings returns DEFAULTS on a wrong schema version", () => {
    const payload = JSON.stringify({
      version: 99,
      settings: {
        masterVolume: 0.1,
        musicVolume: 0.1,
        sfxVolume: 0.1,
        muted: true,
      },
    });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("loadSettings clamps out-of-range stored values via validateSettings", () => {
    const payload = JSON.stringify({
      version: 1,
      settings: {
        masterVolume: 5,
        musicVolume: 0.5,
        sfxVolume: -2,
        muted: true,
      },
    });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadSettings()).toEqual({
      masterVolume: 1,
      musicVolume: 0.5,
      sfxVolume: 0,
      muted: true,
      positionalAudio: true,
      hrtf: false,
      effects: DEFAULTS.effects,
      tilt: DEFAULTS.tilt,
    });
  });

  it("saveSettings is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() =>
      saveSettings({
        masterVolume: 0.5,
        musicVolume: 0.5,
        sfxVolume: 0.5,
        muted: false,
        positionalAudio: true,
        hrtf: false,
        effects: DEFAULTS.effects,
        tilt: DEFAULTS.tilt,
      }),
    ).not.toThrow();
  });

  it("loadSettings returns DEFAULTS when localStorage is unavailable (undefined)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it("saveSettings writes a versioned payload under the storage key", () => {
    saveSettings({
      masterVolume: 0.6,
      musicVolume: 0.6,
      sfxVolume: 0.6,
      muted: false,
      positionalAudio: true,
      hrtf: false,
      effects: DEFAULTS.effects,
      tilt: DEFAULTS.tilt,
    });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; settings: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.settings).toEqual({
      masterVolume: 0.6,
      musicVolume: 0.6,
      sfxVolume: 0.6,
      muted: false,
      positionalAudio: true,
      hrtf: false,
      effects: DEFAULTS.effects,
      tilt: DEFAULTS.tilt,
    });
  });
});
