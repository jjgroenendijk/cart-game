/**
 * Versioned localStorage persistence for the camera mode v1. Mirrors
 * weatherStorage.ts: every localStorage access is wrapped in try/catch so a
 * missing/corrupt/private-mode store never throws. loadCameraMode falls back
 * to DEFAULT_CAMERA_MODE, saveCameraMode is a no-op on failure. Pure except
 * for localStorage I/O; cameraModeConfig.ts owns all validation. Uses a
 * distinct key from the weather, time-of-day, kart-selection, circuit, and
 * settings stores so they never collide.
 */

import { DEFAULT_CAMERA_MODE, validateCameraMode, type CameraMode } from "./cameraModeConfig";

const STORAGE_KEY = "gamecart.cameraMode.v1";
const SCHEMA_VERSION = 1;

interface StoredCameraMode {
  version: number;
  mode: unknown;
}

/**
 * Load the persisted camera mode. Returns DEFAULT_CAMERA_MODE when the store
 * is missing/corrupt or the schema version differs. Never throws.
 */
export function loadCameraMode(): CameraMode {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_CAMERA_MODE;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as StoredCameraMode).version === SCHEMA_VERSION
    ) {
      return validateCameraMode((parsed as StoredCameraMode).mode);
    }
    return DEFAULT_CAMERA_MODE;
  } catch {
    return DEFAULT_CAMERA_MODE;
  }
}

/**
 * Persist the camera mode under the v1 schema. Normalizes the input via
 * validateCameraMode before writing so the store never holds an invalid
 * value. No-op (swallow) when localStorage is unavailable or quota/private-mode
 * rejects the write. Never throws.
 */
export function saveCameraMode(mode: CameraMode): void {
  try {
    const payload: StoredCameraMode = {
      version: SCHEMA_VERSION,
      mode: validateCameraMode(mode),
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op: store unavailable or write rejected */
  }
}
