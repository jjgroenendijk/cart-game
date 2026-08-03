/**
 * Pure camera-mode config. Owns the chase/free-fly choice the start-menu
 * CAMERA selector exposes, plus validateCameraMode, which normalizes any
 * input into a safe CameraMode (bad fields fall back to "chase", never
 * throws). Mirrors weatherConfig.ts / timeOfDayConfig.ts and the settings/
 * kartSelection split. Pure (no DOM, no localStorage); cameraModeStorage.ts
 * persists it. CameraMode maps onto FreeFlyCamera.setActive: "freefly" -> the
 * spectator cam renders, "chase" -> the normal PlayerView chase cam.
 */

export const CAMERA_MODE_VALUES = ["chase", "freefly"] as const;
export type CameraMode = (typeof CAMERA_MODE_VALUES)[number];

export const CAMERA_MODE_LABELS = ["CHASE", "FREE-FLY"];

export const DEFAULT_CAMERA_MODE: CameraMode = "chase";

const VALID_MODES: ReadonlySet<CameraMode> = new Set(CAMERA_MODE_VALUES);

/**
 * Validate + normalize unknown input to a safe CameraMode. Returns the default
 * "chase" for non-string/unknown values and accepts only the 2
 * CAMERA_MODE_VALUES. Never throws.
 */
export function validateCameraMode(input: unknown): CameraMode {
  return typeof input === "string" && VALID_MODES.has(input as CameraMode)
    ? (input as CameraMode)
    : DEFAULT_CAMERA_MODE;
}
