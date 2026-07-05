import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ID } from "../terrain/circuitCode";
import { loadCircuitId, saveCircuitId } from "./circuitStorage";

const STORAGE_KEY = "gamecart.circuit.v1";

/**
 * Minimal in-memory Storage shim (see storage.test.ts for rationale):
 * vitest/jsdom does not expose a usable global localStorage, so tests stub a
 * Storage-like object onto globalThis.localStorage. circuitStorage.ts reads
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

describe("circuitStorage (058)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadCircuitId returns DEFAULT_ID when nothing is stored", () => {
    expect(loadCircuitId()).toEqual(DEFAULT_ID);
  });

  it("saveCircuitId then loadCircuitId round-trips the id", () => {
    saveCircuitId({ seed: 123456, biome: 2 });
    expect(loadCircuitId()).toEqual({ seed: 123456, biome: 2 });
  });

  it("loadCircuitId returns DEFAULT_ID on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadCircuitId()).not.toThrow();
    expect(loadCircuitId()).toEqual(DEFAULT_ID);
  });

  it("loadCircuitId returns DEFAULT_ID on a wrong schema version", () => {
    const payload = JSON.stringify({ version: 99, seed: 5, biome: 1 });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadCircuitId()).toEqual(DEFAULT_ID);
  });

  it("saveCircuitId normalizes invalid ids on save", () => {
    saveCircuitId({ seed: -1, biome: 99 });
    expect(loadCircuitId()).toEqual({ seed: 4294967295, biome: 0 });
  });

  it("loadCircuitId returns DEFAULT_ID when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadCircuitId()).not.toThrow();
    expect(loadCircuitId()).toEqual(DEFAULT_ID);
  });

  it("saveCircuitId is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveCircuitId({ seed: 5, biome: 1 })).not.toThrow();
  });

  it("saveCircuitId writes a versioned payload under the storage key", () => {
    saveCircuitId({ seed: 777, biome: 3 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; seed: unknown; biome: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.seed).toBe(777);
    expect(parsed.biome).toBe(3);
  });
});
