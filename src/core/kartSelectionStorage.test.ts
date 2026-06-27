import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KartVariantId } from "../kart/kartVariants";
import { DEFAULT_SELECTION } from "./kartSelection";
import { loadKartSelection, saveKartSelection } from "./kartSelectionStorage";

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

describe("kartSelectionStorage (024)", () => {
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

  it("saveKartSelection then loadKartSelection round-trips the ids", () => {
    saveKartSelection(["speed", "heavy"]);
    expect(loadKartSelection()).toEqual(["speed", "heavy"]);
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

  it("saveKartSelection normalizes invalid ids on save", () => {
    saveKartSelection(["speed", "bogus"] as unknown as KartVariantId[]);
    expect(loadKartSelection()).toEqual(["speed", "balanced"]);
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
    expect(() => saveKartSelection(["speed", "heavy"])).not.toThrow();
  });

  it("saveKartSelection writes a versioned payload under the storage key", () => {
    saveKartSelection(["speed", "heavy"]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; selection: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.selection).toEqual(["speed", "heavy"]);
  });
});
