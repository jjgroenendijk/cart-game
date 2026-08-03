import { describe, expect, it } from "vitest";
import {
  CAMERA_MODE_VALUES,
  DEFAULT_CAMERA_MODE,
  validateCameraMode,
  type CameraMode,
} from "./cameraModeConfig";

describe("cameraModeConfig", () => {
  it("validateCameraMode accepts all CAMERA_MODE_VALUES", () => {
    for (const mode of CAMERA_MODE_VALUES) {
      expect(validateCameraMode(mode)).toBe(mode);
    }
  });

  it("validateCameraMode returns DEFAULT_CAMERA_MODE (chase) for unknown strings", () => {
    expect(validateCameraMode("orbit")).toBe(DEFAULT_CAMERA_MODE);
    expect(validateCameraMode("")).toBe(DEFAULT_CAMERA_MODE);
  });

  it("validateCameraMode returns DEFAULT_CAMERA_MODE for non-strings", () => {
    expect(validateCameraMode(null)).toBe(DEFAULT_CAMERA_MODE);
    expect(validateCameraMode(undefined)).toBe(DEFAULT_CAMERA_MODE);
    expect(validateCameraMode(42)).toBe(DEFAULT_CAMERA_MODE);
    expect(validateCameraMode({ mode: "freefly" })).toBe(DEFAULT_CAMERA_MODE);
    expect(validateCameraMode(["freefly"])).toBe(DEFAULT_CAMERA_MODE);
  });

  it("DEFAULT_CAMERA_MODE is chase", () => {
    const chase: CameraMode = DEFAULT_CAMERA_MODE;
    expect(chase).toBe("chase");
  });
});
