import { describe, expect, it } from "vitest";
import {
  SKY_CAPTURE_FACE_COUNT,
  cubeMipCount,
  nextCaptureFace,
  roughnessToMipLevel,
  shouldCaptureSky,
} from "./SkyCapture";

describe("shouldCaptureSky", () => {
  it("forces a capture on the first bake (prevCycleT null)", () => {
    expect(shouldCaptureSky(null, 0)).toBe(true);
    expect(shouldCaptureSky(null, 0.42)).toBe(true);
  });

  it("returns false when the advance is below the default threshold (1/64)", () => {
    expect(shouldCaptureSky(0.5, 0.5 + 0.01)).toBe(false); // delta 0.01 < 1/64
  });

  it("returns true once the cycle advanced past the threshold (inclusive)", () => {
    expect(shouldCaptureSky(0.5, 0.5 + 1 / 64)).toBe(true); // delta == threshold
    expect(shouldCaptureSky(0.5, 0.5 + 0.02)).toBe(true); // delta 0.02 > 1/64
  });

  it("handles wraparound across the 1.0 == 0.0 seam (shortest forward delta)", () => {
    expect(shouldCaptureSky(0.99, 0.005)).toBe(false); // delta ~0.015 < 1/64
    expect(shouldCaptureSky(0.99, 0.02)).toBe(true); // delta ~0.03 >= 1/64
    expect(shouldCaptureSky(0.9, 0.0)).toBe(true); // delta 0.1
  });

  it("respects a custom threshold fraction", () => {
    expect(shouldCaptureSky(0.2, 0.25, 0.1)).toBe(false); // delta 0.05 < 0.1
    expect(shouldCaptureSky(0.2, 0.35, 0.1)).toBe(true); // delta 0.15 >= 0.1
  });

  it("treats zero forward delta as below threshold", () => {
    expect(shouldCaptureSky(0.3, 0.3)).toBe(false);
    expect(shouldCaptureSky(0.3, 1.3)).toBe(false); // wraps to exactly same phase
  });
});

describe("nextCaptureFace", () => {
  it("rotates 0 -> 1 -> ... -> 5 -> 0", () => {
    expect(nextCaptureFace(0)).toBe(1);
    expect(nextCaptureFace(1)).toBe(2);
    expect(nextCaptureFace(2)).toBe(3);
    expect(nextCaptureFace(3)).toBe(4);
    expect(nextCaptureFace(4)).toBe(5);
    expect(nextCaptureFace(5)).toBe(0);
  });

  it("completes a full cycle in SKY_CAPTURE_FACE_COUNT steps", () => {
    let face = 0;
    for (let i = 0; i < SKY_CAPTURE_FACE_COUNT; i++) face = nextCaptureFace(face);
    expect(face).toBe(0);
  });
});

describe("roughnessToMipLevel", () => {
  it("maps roughness 0 (mirror) to mip 0 (sharpest)", () => {
    expect(roughnessToMipLevel(0, 8)).toBe(0);
  });

  it("maps roughness 1 (fully diffuse) to the top mip (blurriest)", () => {
    expect(roughnessToMipLevel(1, 8)).toBe(7);
    expect(roughnessToMipLevel(1, 7)).toBe(6);
  });

  it("returns 0 when mipCount <= 1", () => {
    expect(roughnessToMipLevel(0, 1)).toBe(0);
    expect(roughnessToMipLevel(1, 1)).toBe(0);
    expect(roughnessToMipLevel(0.5, 0)).toBe(0);
    expect(roughnessToMipLevel(0.5, -3)).toBe(0);
  });

  it("rounds the midpoint to the nearest mip", () => {
    // 8 mips -> top 7; roughness 0.5 -> floor(0.5*7+0.5)=floor(4)=4
    expect(roughnessToMipLevel(0.5, 8)).toBe(4);
    // 7 mips -> top 6; roughness 0.5 -> floor(0.5*6+0.5)=floor(3.5)=3
    expect(roughnessToMipLevel(0.5, 7)).toBe(3);
  });

  it("clamps out-of-range roughness into [0, top]", () => {
    expect(roughnessToMipLevel(-0.5, 8)).toBe(0);
    expect(roughnessToMipLevel(2, 8)).toBe(7);
  });
});

describe("cubeMipCount", () => {
  it("is 1 for size 1", () => {
    expect(cubeMipCount(1)).toBe(1);
  });

  it("is 7 for size 64", () => {
    expect(cubeMipCount(64)).toBe(7);
  });

  it("is 8 for size 128", () => {
    expect(cubeMipCount(128)).toBe(8);
  });

  it("is 1 for non-positive sizes", () => {
    expect(cubeMipCount(0)).toBe(1);
    expect(cubeMipCount(-4)).toBe(1);
  });
});
