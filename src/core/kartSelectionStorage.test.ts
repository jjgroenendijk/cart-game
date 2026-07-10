import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SELECTION, type KartPick } from "./kartSelection";
import { loadKartSelection, saveKartSelection } from "./kartSelectionStorage";

const SPEED: KartPick = { variant: "speed", colorway: "glacier" };
const HEAVY: KartPick = { variant: "heavy", colorway: "violet" };

const STORAGE_KEY = "gamecart.kartSelection.v1";

/**
 * Minimal in-memory Storage shim (see storage.test.ts for rationale):
 * vitest/jsdom does not expose a usable global localStorage, so tests stub a
 * Storage-like object onto globalThis.localStorage. kartSelectionStorage.ts
 * reads it via globalThis.localStorage, so this exercises the real code path.
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

describe("kartSelectionStorage (024/083)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadKartSelection returns DEFAULT_SELECTION when nothing is stored", () => {
    expect(loadKartSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("saveKartSelection then loadKartSelection round-trips the picks", () => {
    saveKartSelection([SPEED, HEAVY]);
    expect(loadKartSelection()).toEqual([SPEED, HEAVY]);
  });

  it("loadKartSelection migrates a v1 payload to stock colorways", () => {
    const payload = JSON.stringify({ version: 1, selection: ["speed", "heavy"] });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadKartSelection()).toEqual([SPEED, HEAVY]);
  });

  it("loadKartSelection returns DEFAULT_SELECTION on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadKartSelection()).not.toThrow();
    expect(loadKartSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("loadKartSelection returns DEFAULT_SELECTION on a wrong schema version", () => {
    const payload = JSON.stringify({ version: 99, selection: ["speed", "heavy"] });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadKartSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("saveKartSelection normalizes invalid picks on save", () => {
    saveKartSelection([SPEED, { variant: "bogus", colorway: "nope" }] as unknown as KartPick[]);
    expect(loadKartSelection()).toEqual([SPEED, DEFAULT_SELECTION[1]]);
  });

  it("loadKartSelection returns DEFAULT_SELECTION when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadKartSelection()).not.toThrow();
    expect(loadKartSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("saveKartSelection is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveKartSelection([SPEED, HEAVY])).not.toThrow();
  });

  it("saveKartSelection writes a v2 versioned payload under the storage key", () => {
    saveKartSelection([SPEED, HEAVY]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; selection: unknown };
    expect(parsed.version).toBe(2);
    expect(parsed.selection).toEqual([SPEED, HEAVY]);
  });
});
