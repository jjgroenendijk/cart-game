import { afterEach, beforeEach, vi } from "vitest";

/**
 * Per-test storage isolation for the dom (jsdom) project.
 *
 * `globalThis.localStorage` availability varies across runtimes: undefined
 * under the local vitest/jsdom run, but a working persistent experimental
 * store on CI's Node 24. That mismatch hides storage-leak bugs locally
 * (e.g. Game boots from a circuit id a prior test persisted via
 * saveCircuitId). Stub a fresh in-memory Storage before each test so
 * boot-from-storage code paths are deterministic in every environment.
 *
 * Tests that need a specific store shape (or undefined) re-stub in their own
 * beforeEach; vi.stubGlobal overwrites this one and vi.unstubAllGlobals in
 * afterEach is idempotent.
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

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});
