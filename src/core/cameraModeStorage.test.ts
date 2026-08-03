import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_MODE } from "./cameraModeConfig";
import { loadCameraMode, saveCameraMode } from "./cameraModeStorage";

const STORAGE_KEY = "gamecart.cameraMode.v1";

/**
 * Minimal in-memory Storage shim (see weatherStorage.test.ts for rationale):
 * vitest/jsdom does not expose a usable global localStorage, so tests stub a
 * Storage-like object onto globalThis.localStorage. cameraModeStorage.ts reads
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

describe("cameraModeStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loadCameraMode returns DEFAULT_CAMERA_MODE when nothing is stored", () => {
    expect(loadCameraMode()).toBe(DEFAULT_CAMERA_MODE);
  });

  it("saveCameraMode then loadCameraMode round-trips the mode", () => {
    saveCameraMode("freefly");
    expect(loadCameraMode()).toBe("freefly");
  });

  it("loadCameraMode returns DEFAULT_CAMERA_MODE on corrupt JSON (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => loadCameraMode()).not.toThrow();
    expect(loadCameraMode()).toBe(DEFAULT_CAMERA_MODE);
  });

  it("loadCameraMode returns DEFAULT_CAMERA_MODE on a wrong schema version", () => {
    const payload = JSON.stringify({ version: 99, mode: "freefly" });
    localStorage.setItem(STORAGE_KEY, payload);
    expect(loadCameraMode()).toBe(DEFAULT_CAMERA_MODE);
  });

  it("saveCameraMode normalizes an invalid mode on save", () => {
    saveCameraMode("orbit" as never);
    expect(loadCameraMode()).toBe(DEFAULT_CAMERA_MODE);
  });

  it("loadCameraMode returns DEFAULT_CAMERA_MODE when localStorage is undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadCameraMode()).not.toThrow();
    expect(loadCameraMode()).toBe(DEFAULT_CAMERA_MODE);
  });

  it("saveCameraMode is a no-op (never throws) when setItem throws", () => {
    const throwing = makeStorage();
    throwing.setItem = () => {
      throw new Error("quota");
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => saveCameraMode("freefly")).not.toThrow();
  });

  it("saveCameraMode writes a versioned payload under the storage key", () => {
    saveCameraMode("freefly");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; mode: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.mode).toBe("freefly");
  });
});
